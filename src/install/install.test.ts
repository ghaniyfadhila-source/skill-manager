import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadAdapters } from "../adapters/loader.js";
import type { Adapter } from "../adapters/manifest.js";
import { SkillManagerError } from "../core/errors.js";
import { contentHash } from "../core/hash.js";
import { libraryRoot } from "../core/paths.js";
import { loadState, saveState } from "../core/state.js";
import { type Skill, STATE_SCHEMA_VERSION, type StateFile } from "../core/types.js";
import { TEMP_PREFIX } from "../fs/atomic.js";
import { MemoryFileSystem } from "../fs/memory.js";
import { type FsResult, fsErr } from "../fs/types.js";
import { installSkill } from "./install.js";

const HOME = path.resolve(path.sep, "sm-install-home");
const DATA_ROOT = path.resolve(path.sep, "sm-install-data");
const LIBRARY = libraryRoot(DATA_ROOT);
const SKILL_NAME = "brainstorming";

function ok<T>(result: FsResult<T>): T {
  if (!result.ok) {
    throw new Error(`Operasi gagal: ${result.error.code} — ${result.error.message}`);
  }
  return result.value;
}

async function captureError(run: () => Promise<unknown>): Promise<SkillManagerError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof SkillManagerError) {
      return error;
    }
    throw error;
  }
  throw new Error("Fungsi seharusnya melempar SkillManagerError");
}

function tempNames(entries: readonly { readonly name: string }[]): string[] {
  return entries.map((entry) => entry.name).filter((name) => name.startsWith(TEMP_PREFIX));
}

async function mkdirp(fs: MemoryFileSystem, dir: string): Promise<void> {
  ok(await fs.mkdir(dir, { recursive: true }));
}

/** Simulasi kegagalan izin hanya pada Store opencode. */
class CopyDeniedFs extends MemoryFileSystem {
  override async copy(source: string, destination: string): Promise<FsResult<void>> {
    if (destination.startsWith(path.join(HOME, ".config", "opencode"))) {
      return fsErr("permission_denied", destination, "Akses ditolak (simulasi).");
    }
    return super.copy(source, destination);
  }
}

interface Fixture {
  readonly fs: MemoryFileSystem;
  readonly adapters: readonly Adapter[];
  readonly skill: Skill;
}

async function fixture(options: { fs?: MemoryFileSystem } = {}): Promise<Fixture> {
  const fs = options.fs ?? new MemoryFileSystem();
  const source = path.join(LIBRARY, SKILL_NAME);
  await mkdirp(fs, path.join(source, "references"));
  ok(await fs.write(path.join(source, "SKILL.md"), "# Brainstorming\n"));
  ok(await fs.write(path.join(source, "references", "tips.md"), "tips\n"));
  const skill: Skill = {
    id: "sk_test",
    name: SKILL_NAME,
    dirName: SKILL_NAME,
    contentHash: ok(await contentHash(fs, source)),
    source: { type: "folder", path: path.join(HOME, "asal") },
    importedAt: "2026-11-05T00:00:00Z",
  };
  const state: StateFile = {
    schemaVersion: STATE_SCHEMA_VERSION,
    library: [skill],
    installations: [],
    projects: [],
    settings: { sharedGroupMembers: [] },
  };
  ok(await saveState(fs, DATA_ROOT, state));
  const catalog = await loadAdapters({ fs, dataRoot: DATA_ROOT });
  return { fs, adapters: catalog.adapters, skill };
}

function storePathHarness(harness: string): string {
  switch (harness) {
    case "claude-code":
      return path.join(HOME, ".claude", "skills");
    case "opencode":
      return path.join(HOME, ".config", "opencode", "skills");
    case "antigravity":
      return path.join(HOME, ".gemini", "config", "skills");
    default:
      return path.join(HOME, ".agents", "skills");
  }
}

function installTo(fixtureValue: Fixture, targets: readonly string[], extra = {}) {
  return installSkill({
    fs: fixtureValue.fs,
    dataRoot: DATA_ROOT,
    adapters: fixtureValue.adapters,
    home: HOME,
    skill: SKILL_NAME,
    targets,
    ...extra,
  });
}

describe("installSkill", () => {
  it("menyalin satu skill ke Store lalu mencatat Installation", async () => {
    const setup = await fixture();

    const results = await installTo(setup, ["claude-code/global"]);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ targetId: "claude-code/global", ok: true });
    const destination = path.join(storePathHarness("claude-code"), SKILL_NAME);
    expect(ok(await contentHash(setup.fs, destination))).toBe(setup.skill.contentHash);

    const { state } = await loadState(setup.fs, DATA_ROOT);
    expect(state.installations).toHaveLength(1);
    expect(state.installations[0]).toMatchObject({
      skillId: setup.skill.id,
      storeId: "~/.claude/skills",
      mode: "copy",
      installedHash: setup.skill.contentHash,
    });
  });

  it("memasang satu skill ke semua Target managed (AC-4)", async () => {
    const setup = await fixture();
    const targets = [
      "claude-code/global",
      "opencode/global",
      "antigravity/global",
      "shared/global",
    ];

    const results = await installTo(setup, targets, { acknowledgeShared: true });

    expect(results.map((result) => [result.targetId, result.ok])).toEqual(
      targets.map((targetId) => [targetId, true]),
    );
    for (const harness of ["claude-code", "opencode", "antigravity", "shared"]) {
      const store = storePathHarness(harness);
      const destination = path.join(store, SKILL_NAME);
      expect(ok(await contentHash(setup.fs, destination))).toBe(setup.skill.contentHash);
      expect(tempNames(ok(await setup.fs.readdir(store)))).toEqual([]);
    }

    const { state } = await loadState(setup.fs, DATA_ROOT);
    expect(state.installations.map((installation) => installation.storeId)).toEqual([
      "~/.claude/skills",
      "~/.config/opencode/skills",
      "~/.gemini/config/skills",
      "~/.agents/skills",
    ]);
  });

  it("hanya menulis ke Store Target yang dipilih, Store shared tidak berubah (AC-5)", async () => {
    const setup = await fixture();

    const results = await installTo(setup, ["claude-code/global", "opencode/global"]);

    expect(results.every((result) => result.ok)).toBe(true);
    for (const harness of ["claude-code", "opencode"]) {
      expect(await setup.fs.exists(path.join(storePathHarness(harness), SKILL_NAME))).toBe(true);
    }
    expect(await setup.fs.exists(path.join(storePathHarness("shared"), SKILL_NAME))).toBe(false);
    expect(await setup.fs.exists(storePathHarness("shared"))).toBe(false);

    const { state } = await loadState(setup.fs, DATA_ROOT);
    expect(state.installations.map((installation) => installation.storeId)).toEqual([
      "~/.claude/skills",
      "~/.config/opencode/skills",
    ]);
  });

  it("menolak grup shared tanpa persetujuan dan menyebut member terdampak (AC-6)", async () => {
    const setup = await fixture();

    const error = await captureError(() => installTo(setup, ["shared/global"]));

    expect(error.code).toBe("shared_confirmation_required");
    expect(error.message).toContain("~/.agents/skills");
    for (const member of ["codex", "gemini", "cursor"]) {
      expect(error.message).toContain(member);
    }
    expect(error.details).toMatchObject({
      stores: [
        {
          storeId: "~/.agents/skills",
          members: expect.arrayContaining(["codex", "gemini", "cursor"]),
        },
      ],
      targets: ["shared/global"],
    });
    expect(await setup.fs.exists(path.join(storePathHarness("shared"), SKILL_NAME))).toBe(false);
    const { state } = await loadState(setup.fs, DATA_ROOT);
    expect(state.installations).toEqual([]);
  });

  it("memasang ke grup shared setelah disetujui (AC-6)", async () => {
    const setup = await fixture();

    const results = await installTo(setup, ["shared/global"], { acknowledgeShared: true });

    expect(results[0]).toMatchObject({
      targetId: "shared/global",
      ok: true,
      installation: { storeId: "~/.agents/skills", mode: "copy" },
    });
    expect(
      await setup.fs.exists(path.join(storePathHarness("shared"), SKILL_NAME, "SKILL.md")),
    ).toBe(true);
  });

  it("opencode bisa dialihkan ke grup shared dengan peringatan yang sama", async () => {
    const setup = await fixture();

    const error = await captureError(() => installTo(setup, ["opencode/global"], { shared: true }));
    expect(error.code).toBe("shared_confirmation_required");

    const results = await installTo(setup, ["opencode/global"], {
      shared: true,
      acknowledgeShared: true,
    });
    expect(results[0]).toMatchObject({
      ok: true,
      installation: { storeId: "~/.agents/skills" },
    });
    expect(await setup.fs.exists(path.join(storePathHarness("opencode"), SKILL_NAME))).toBe(false);
  });

  it("menolak konflik tanpa menimpa isi lama dan menyebut pemiliknya", async () => {
    const setup = await fixture();
    const store = storePathHarness("claude-code");
    const existing = path.join(store, SKILL_NAME);
    await mkdirp(setup.fs, existing);
    ok(await setup.fs.write(path.join(existing, "SKILL.md"), "# versi lama\n"));
    const { state } = await loadState(setup.fs, DATA_ROOT);
    ok(
      await saveState(setup.fs, DATA_ROOT, {
        ...state,
        installations: [
          {
            skillId: setup.skill.id,
            storeId: "~/.claude/skills",
            mode: "copy",
            installedHash: setup.skill.contentHash,
            installedAt: "2026-11-01T00:00:00Z",
          },
        ],
      }),
    );

    const results = await installTo(setup, ["claude-code/global"]);

    expect(results[0]).toMatchObject({
      targetId: "claude-code/global",
      ok: false,
      error: { code: "install_conflict" },
    });
    expect(results[0]?.error?.details).toMatchObject({
      storeId: "~/.claude/skills",
      owner: { skillId: setup.skill.id, name: SKILL_NAME },
    });
    expect(ok(await setup.fs.readText(path.join(existing, "SKILL.md")))).toBe("# versi lama\n");
    expect(tempNames(ok(await setup.fs.readdir(store)))).toEqual([]);
    const after = await loadState(setup.fs, DATA_ROOT);
    expect(after.state.installations[0]?.installedAt).toBe("2026-11-01T00:00:00Z");
  });

  it("kegagalan satu Target tidak membatalkan Target lain (spec §14)", async () => {
    const setup = await fixture({ fs: new CopyDeniedFs() });

    const results = await installTo(setup, ["claude-code/global", "opencode/global"]);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ targetId: "claude-code/global", ok: true });
    expect(results[1]).toMatchObject({
      targetId: "opencode/global",
      ok: false,
      error: { code: "permission_denied" },
    });
    expect(
      await setup.fs.exists(path.join(storePathHarness("claude-code"), SKILL_NAME, "SKILL.md")),
    ).toBe(true);
    expect(await setup.fs.exists(path.join(storePathHarness("opencode"), SKILL_NAME))).toBe(false);
    expect(tempNames(ok(await setup.fs.readdir(storePathHarness("opencode"))))).toEqual([]);
    const { state } = await loadState(setup.fs, DATA_ROOT);
    expect(state.installations.map((installation) => installation.storeId)).toEqual([
      "~/.claude/skills",
    ]);
  });

  it("selalu mode copy dan tidak membuat tautan (symlink bukan v0.1)", async () => {
    const setup = await fixture();

    const results = await installTo(setup, ["claude-code/global"]);

    expect(results[0]?.installation?.mode).toBe("copy");
    const store = storePathHarness("claude-code");
    expect(ok(await setup.fs.readdir(store))).toEqual([
      { name: SKILL_NAME, kind: "directory", isSymlink: false },
    ]);
    expect(ok(await setup.fs.lstat(path.join(store, SKILL_NAME))).kind).toBe("directory");
  });

  it("menolak skill yang tidak ada di Library", async () => {
    const setup = await fixture();

    const error = await captureError(() =>
      installSkill({
        fs: setup.fs,
        dataRoot: DATA_ROOT,
        adapters: setup.adapters,
        home: HOME,
        skill: "tidak-ada",
        targets: ["claude-code/global"],
      }),
    );

    expect(error.code).toBe("skill_not_found");
    expect(await setup.fs.exists(storePathHarness("claude-code"))).toBe(false);
  });
});
