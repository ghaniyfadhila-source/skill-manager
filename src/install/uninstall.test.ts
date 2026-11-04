import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadAdapters } from "../adapters/loader.js";
import type { Adapter } from "../adapters/manifest.js";
import { contentHash } from "../core/hash.js";
import { libraryRoot } from "../core/paths.js";
import { loadState, saveState } from "../core/state.js";
import { type Skill, STATE_SCHEMA_VERSION, type StateFile } from "../core/types.js";
import { TEMP_PREFIX } from "../fs/atomic.js";
import { MemoryFileSystem } from "../fs/memory.js";
import type { FsResult } from "../fs/types.js";
import { installSkill } from "./install.js";
import { uninstallSkill } from "./uninstall.js";

const HOME = path.resolve(path.sep, "sm-uninstall-home");
const DATA_ROOT = path.resolve(path.sep, "sm-uninstall-data");
const LIBRARY = libraryRoot(DATA_ROOT);
const SKILL_NAME = "brainstorming";
const SKILL_MD = "# Brainstorming\n";
const TIPS = "tips\n";

function ok<T>(result: FsResult<T>): T {
  if (!result.ok) {
    throw new Error(`Operasi gagal: ${result.error.code} — ${result.error.message}`);
  }
  return result.value;
}

async function mkdirp(fs: MemoryFileSystem, dir: string): Promise<void> {
  ok(await fs.mkdir(dir, { recursive: true }));
}

interface Fixture {
  readonly fs: MemoryFileSystem;
  readonly adapters: readonly Adapter[];
  readonly skill: Skill;
}

async function fixture(): Promise<Fixture> {
  const fs = new MemoryFileSystem();
  const source = path.join(LIBRARY, SKILL_NAME);
  await mkdirp(fs, path.join(source, "references"));
  ok(await fs.write(path.join(source, "SKILL.md"), SKILL_MD));
  ok(await fs.write(path.join(source, "references", "tips.md"), TIPS));
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

async function installTo(setup: Fixture, targets: readonly string[], extra = {}) {
  const results = await installSkill({
    fs: setup.fs,
    dataRoot: DATA_ROOT,
    adapters: setup.adapters,
    home: HOME,
    skill: SKILL_NAME,
    targets,
    ...extra,
  });
  for (const result of results) {
    if (!result.ok) {
      throw new Error(`Pasang gagal: ${result.error?.code} — ${result.error?.message}`);
    }
  }
  return results;
}

function uninstallFrom(setup: Fixture, targets: readonly string[], extra = {}) {
  return uninstallSkill({
    fs: setup.fs,
    dataRoot: DATA_ROOT,
    adapters: setup.adapters,
    home: HOME,
    skill: SKILL_NAME,
    targets,
    ...extra,
  });
}

function installedPath(harness: string): string {
  return path.join(storePathHarness(harness), SKILL_NAME);
}

async function tempNames(setup: Fixture, harness: string): Promise<string[]> {
  const entries = ok(await setup.fs.readdir(storePathHarness(harness)));
  return entries.map((entry) => entry.name).filter((name) => name.startsWith(TEMP_PREFIX));
}

describe("uninstallSkill", () => {
  it("mencabut Installation dengan hash sama: direktori dan catatan state hilang", async () => {
    const setup = await fixture();
    await installTo(setup, ["claude-code/global"]);

    const results = await uninstallFrom(setup, ["claude-code/global"]);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      targetId: "claude-code/global",
      ok: true,
      installation: {
        skillId: setup.skill.id,
        storeId: "~/.claude/skills",
        installedHash: setup.skill.contentHash,
      },
    });
    expect(await setup.fs.exists(installedPath("claude-code"))).toBe(false);
    const { state } = await loadState(setup.fs, DATA_ROOT);
    expect(state.installations).toEqual([]);
  });

  it("membersihkan catatan Installation yang direktorinya sudah hilang", async () => {
    const setup = await fixture();
    await installTo(setup, ["claude-code/global"]);
    ok(await setup.fs.remove(installedPath("claude-code"), { recursive: true }));

    const results = await uninstallFrom(setup, ["claude-code/global"]);

    expect(results[0]).toMatchObject({
      targetId: "claude-code/global",
      ok: true,
      installation: { storeId: "~/.claude/skills" },
    });
    expect(await setup.fs.exists(installedPath("claude-code"))).toBe(false);
    const { state } = await loadState(setup.fs, DATA_ROOT);
    expect(state.installations).toEqual([]);
  });

  it("menolak menghapus saat hash berbeda dan menyebut kedua hash (AC-7)", async () => {
    const setup = await fixture();
    await installTo(setup, ["claude-code/global"]);
    const destination = installedPath("claude-code");
    ok(await setup.fs.write(path.join(destination, "SKILL.md"), "# diubah user\n"));
    const actualHash = ok(await contentHash(setup.fs, destination));
    expect(actualHash).not.toBe(setup.skill.contentHash);

    const results = await uninstallFrom(setup, ["claude-code/global"]);

    expect(results[0]).toMatchObject({
      targetId: "claude-code/global",
      ok: false,
      error: { code: "drift_detected" },
    });
    expect(results[0]?.error?.details).toEqual({
      storeId: "~/.claude/skills",
      path: destination,
      expectedHash: setup.skill.contentHash,
      actualHash,
    });
    expect(ok(await setup.fs.readText(path.join(destination, "SKILL.md")))).toBe("# diubah user\n");
    const { state } = await loadState(setup.fs, DATA_ROOT);
    expect(state.installations).toHaveLength(1);
    expect(state.installations[0]?.installedHash).toBe(setup.skill.contentHash);
  });

  it("menghapus meski hash berbeda bila force diminta eksplisit", async () => {
    const setup = await fixture();
    await installTo(setup, ["claude-code/global"]);
    ok(await setup.fs.write(path.join(installedPath("claude-code"), "SKILL.md"), "# diubah\n"));

    const results = await uninstallFrom(setup, ["claude-code/global"], { force: true });

    expect(results[0]).toMatchObject({ targetId: "claude-code/global", ok: true });
    expect(await setup.fs.exists(installedPath("claude-code"))).toBe(false);
    const { state } = await loadState(setup.fs, DATA_ROOT);
    expect(state.installations).toEqual([]);
  });

  it("best-effort multi-Target: yang bersih tercabut, yang drift dilaporkan", async () => {
    const setup = await fixture();
    await installTo(setup, ["claude-code/global", "opencode/global"]);
    ok(
      await setup.fs.write(path.join(installedPath("claude-code"), "SKILL.md"), "# diubah user\n"),
    );

    const results = await uninstallFrom(setup, ["claude-code/global", "opencode/global"]);

    expect(results.map((result) => [result.targetId, result.ok])).toEqual([
      ["claude-code/global", false],
      ["opencode/global", true],
    ]);
    expect(results[0]?.error?.code).toBe("drift_detected");
    expect(await setup.fs.exists(installedPath("claude-code"))).toBe(true);
    expect(await setup.fs.exists(installedPath("opencode"))).toBe(false);
    const { state } = await loadState(setup.fs, DATA_ROOT);
    expect(state.installations.map((installation) => installation.storeId)).toEqual([
      "~/.claude/skills",
    ]);
    expect(await tempNames(setup, "claude-code")).toEqual([]);
    expect(await tempNames(setup, "opencode")).toEqual([]);
  });

  it("tidak menyentuh Library dan pemasangan ulang tetap bisa", async () => {
    const setup = await fixture();
    await installTo(setup, ["claude-code/global"]);

    const removed = await uninstallFrom(setup, ["claude-code/global"]);
    expect(removed[0]?.ok).toBe(true);

    expect(await setup.fs.exists(path.join(LIBRARY, SKILL_NAME, "SKILL.md"))).toBe(true);
    expect(ok(await setup.fs.readText(path.join(LIBRARY, SKILL_NAME, "SKILL.md")))).toBe(SKILL_MD);
    expect(
      ok(await setup.fs.readText(path.join(LIBRARY, SKILL_NAME, "references", "tips.md"))),
    ).toBe(TIPS);
    expect(ok(await contentHash(setup.fs, path.join(LIBRARY, SKILL_NAME)))).toBe(
      setup.skill.contentHash,
    );

    const reinstalled = await installTo(setup, ["claude-code/global"]);
    expect(reinstalled[0]).toMatchObject({ ok: true, installation: { mode: "copy" } });
    expect(ok(await contentHash(setup.fs, installedPath("claude-code")))).toBe(
      setup.skill.contentHash,
    );
  });

  it("memberi galat jelas bila Installation tidak tercatat di state", async () => {
    const setup = await fixture();

    const results = await uninstallFrom(setup, ["claude-code/global"]);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      targetId: "claude-code/global",
      ok: false,
      error: { code: "installation_not_found" },
    });
    expect(results[0]?.error?.message).toContain(SKILL_NAME);
    expect(await setup.fs.exists(storePathHarness("claude-code"))).toBe(false);
    const { state } = await loadState(setup.fs, DATA_ROOT);
    expect(state.installations).toEqual([]);
  });

  it("pencabutan berulang ditolak dengan galat jelas, bukan sukses diam-diam", async () => {
    const setup = await fixture();
    await installTo(setup, ["claude-code/global"]);

    const first = await uninstallFrom(setup, ["claude-code/global"]);
    const second = await uninstallFrom(setup, ["claude-code/global"]);

    expect(first[0]?.ok).toBe(true);
    expect(second[0]).toMatchObject({
      targetId: "claude-code/global",
      ok: false,
      error: { code: "installation_not_found" },
    });
    expect(await setup.fs.exists(installedPath("claude-code"))).toBe(false);
    const { state } = await loadState(setup.fs, DATA_ROOT);
    expect(state.installations).toEqual([]);
  });
});
