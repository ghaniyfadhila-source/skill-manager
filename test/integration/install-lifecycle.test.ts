/**
 * AC-4, AC-5, AC-6, AC-7 (spec §15). Semua Store berada di bawah `home` palsu
 * di dalam direktori sementara — home directory asli tidak pernah disentuh.
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Adapter } from "../../src/adapters/index.js";
import { adapterCapability } from "../../src/adapters/manifest.js";
import { SkillManagerError } from "../../src/core/errors.js";
import { contentHash } from "../../src/core/hash.js";
import { loadState } from "../../src/core/state.js";
import type { Skill } from "../../src/core/types.js";
import type { NodeFileSystem } from "../../src/fs/node.js";
import { installSkill } from "../../src/install/install.js";
import { uninstallSkill } from "../../src/install/uninstall.js";
import { importFolderSkill } from "../../src/library/import-folder.js";
import { createHarness, FIXTURES, type IntegrationHarness, ok } from "./harness.js";

const CLAUDE_STORE = "~/.claude/skills";
const OPENCODE_STORE = "~/.config/opencode/skills";
const SHARED_STORE = "~/.agents/skills";

async function capture(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  return undefined;
}

/** Snapshot "path:ukuran" sebuah pohon direktori, untuk membandingkan salinan. */
async function treeSnapshot(fs: NodeFileSystem, root: string, prefix = ""): Promise<string[]> {
  const collected: string[] = [];
  for (const entry of ok(await fs.readdir(root))) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    const full = path.join(root, entry.name);
    if (entry.kind === "directory") {
      collected.push(...(await treeSnapshot(fs, full, relative)));
      continue;
    }
    collected.push(`${relative}:${ok(await fs.stat(full)).size}`);
  }
  return collected.sort();
}

describe("AC-4..AC-7 siklus pasang dan cabut", () => {
  let harness: IntegrationHarness;
  let adapters: readonly Adapter[];
  let skill: Skill;

  beforeEach(async () => {
    harness = await createHarness("install");
    adapters = await harness.adapters();
    const source = await harness.copyFixture(FIXTURES.tipeC);
    skill = (await importFolderSkill(harness.fs, harness.dataRoot, { sourceDir: source })).skill;
    expect(skill.name).toBe("tipeC-python");
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  function install(targets: readonly string[], acknowledgeShared?: boolean) {
    return installSkill({
      fs: harness.fs,
      dataRoot: harness.dataRoot,
      adapters,
      skill: skill.name,
      targets,
      home: harness.home,
      ...(acknowledgeShared === undefined ? {} : { acknowledgeShared }),
    });
  }

  it("AC-4 memasang ke semua Target managed: hash tiap Store sama dengan hash Library", async () => {
    // Diturunkan dari katalog adapter supaya Target baru ikut teruji otomatis.
    const managed = adapters.filter(
      (adapter) => adapterCapability(adapter) === "managed" && adapter.stores.length > 0,
    );
    const targets = managed.map((adapter) => `${adapter.id}/global`);
    expect(targets).toEqual([
      "claude-code/global",
      "opencode/global",
      "antigravity/global",
      "shared/global",
    ]);

    // Grup shared ikut terpasang, jadi persetujuannya diberikan di awal.
    const results = await install(targets, true);
    expect(results.map((result) => [result.targetId, result.ok])).toEqual(
      targets.map((targetId) => [targetId, true]),
    );

    const libraryTree = await treeSnapshot(harness.fs, harness.libraryDir(skill.name));
    const storeIds = managed.flatMap((adapter) => adapter.stores.map((store) => store.path));
    for (const storeId of storeIds) {
      const storePath = harness.storeSkillPath(storeId, skill.name);
      expect(await treeSnapshot(harness.fs, storePath)).toEqual(libraryTree);
      expect(ok(await contentHash(harness.fs, storePath))).toBe(skill.contentHash);
    }

    const { state } = await loadState(harness.fs, harness.dataRoot);
    expect(state.installations).toHaveLength(targets.length);
    for (const installation of state.installations) {
      expect(installation).toMatchObject({
        skillId: skill.id,
        mode: "copy",
        installedHash: skill.contentHash,
      });
    }
    expect(state.installations.map((entry) => entry.storeId).sort()).toEqual([...storeIds].sort());
  });

  it("AC-5 memasang ke [CC] dan opencode saja tidak membuat Store shared", async () => {
    await install(["claude-code/global", "opencode/global"]);

    expect(await harness.fs.exists(harness.storeSkillPath(CLAUDE_STORE, skill.name))).toBe(true);
    expect(await harness.fs.exists(harness.storeSkillPath(OPENCODE_STORE, skill.name))).toBe(true);
    expect(await harness.fs.exists(path.join(harness.home, ".agents"))).toBe(false);
  });

  it("AC-5 Store shared yang sudah ada tidak berubah isi maupun ukurannya", async () => {
    const sharedDir = harness.storeSkillPath(SHARED_STORE, "");
    const foreign = path.join(sharedDir, "skill-lama");
    ok(await harness.fs.mkdir(foreign, { recursive: true }));
    ok(await harness.fs.write(path.join(foreign, "SKILL.md"), "# skill lama\n"));
    const before = await treeSnapshot(harness.fs, sharedDir);

    await install(["claude-code/global", "opencode/global"]);

    expect(await treeSnapshot(harness.fs, sharedDir)).toEqual(before);
    expect(ok(await harness.fs.readText(path.join(foreign, "SKILL.md")))).toBe("# skill lama\n");
    expect(await harness.fs.exists(path.join(sharedDir, skill.name))).toBe(false);
  });

  it("AC-6 memasang ke grup shared tanpa acknowledge ditolak dengan daftar member", async () => {
    const error = await capture(() => install(["shared/global"]));

    expect(error).toBeInstanceOf(SkillManagerError);
    expect((error as SkillManagerError).code).toBe("shared_confirmation_required");
    expect((error as SkillManagerError).message).toContain(SHARED_STORE);
    for (const member of ["codex", "gemini", "cursor"]) {
      expect((error as SkillManagerError).message).toContain(member);
    }
    // Bentuk details dipakai bersama oleh CLI dan UI (kontrak §7); jangan diubah.
    expect((error as SkillManagerError).details).toEqual({
      stores: [
        {
          storeId: SHARED_STORE,
          members: [
            "codex",
            "gemini",
            "cursor",
            "copilot",
            "amp",
            "zed",
            "roo",
            "kilo",
            "factory",
            "dsh",
          ],
        },
      ],
      targets: ["shared/global"],
    });
    expect(await harness.fs.exists(harness.storeSkillPath(SHARED_STORE, skill.name))).toBe(false);
  });

  it("AC-6 dengan acknowledge, skill terpasang untuk grup shared", async () => {
    const results = await install(["shared/global"], true);

    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(true);
    expect(
      ok(await contentHash(harness.fs, harness.storeSkillPath(SHARED_STORE, skill.name))),
    ).toBe(skill.contentHash);
    const { state } = await loadState(harness.fs, harness.dataRoot);
    expect(state.installations[0]?.storeId).toBe(SHARED_STORE);
  });

  it("mencabut dari grup shared juga memakai details yang sama dan menolak tanpa acknowledge", async () => {
    await install(["shared/global"], true);

    const error = await capture(() =>
      uninstallSkill({
        fs: harness.fs,
        dataRoot: harness.dataRoot,
        adapters,
        skill: skill.name,
        targets: ["shared/global"],
        home: harness.home,
      }),
    );

    expect((error as SkillManagerError).code).toBe("shared_confirmation_required");
    const details = (error as SkillManagerError).details as {
      stores: { storeId: string; members: string[] }[];
      targets: string[];
    };
    expect(details.stores[0]?.storeId).toBe(SHARED_STORE);
    expect(details.stores[0]?.members).toContain("codex");
    expect(details.targets).toEqual(["shared/global"]);
    expect(await harness.fs.exists(harness.storeSkillPath(SHARED_STORE, skill.name))).toBe(true);
  });

  it("AC-7 cabut menghapus salinan, Library utuh, dan pasang ulang berhasil tanpa jaringan", async () => {
    const targets = ["claude-code/global", "opencode/global"];
    await install(targets);
    const libraryHash = ok(await contentHash(harness.fs, harness.libraryDir(skill.name)));

    const removed = await uninstallSkill({
      fs: harness.fs,
      dataRoot: harness.dataRoot,
      adapters,
      skill: skill.name,
      targets,
      home: harness.home,
    });

    expect(removed.map((result) => result.ok)).toEqual([true, true]);
    for (const storeDir of [CLAUDE_STORE, OPENCODE_STORE]) {
      expect(await harness.fs.exists(harness.storeSkillPath(storeDir, skill.name))).toBe(false);
    }

    const afterRemoval = await loadState(harness.fs, harness.dataRoot);
    expect(afterRemoval.state.library).toHaveLength(1);
    expect(afterRemoval.state.installations).toEqual([]);
    expect(ok(await contentHash(harness.fs, harness.libraryDir(skill.name)))).toBe(libraryHash);
    expect(
      ok(await harness.fs.readText(path.join(harness.libraryDir(skill.name), "SKILL.md"))),
    ).toContain("tipeC-python");

    const reinstalled = await install(targets);
    expect(reinstalled.map((result) => result.ok)).toEqual([true, true]);
    expect(
      ok(await contentHash(harness.fs, harness.storeSkillPath(CLAUDE_STORE, skill.name))),
    ).toBe(libraryHash);
  });
});
