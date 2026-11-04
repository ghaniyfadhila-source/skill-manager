import path from "node:path";
import { describe, expect, it } from "vitest";
import { contentHash } from "../core/hash.js";
import { loadState, saveState } from "../core/state.js";
import { MemoryFileSystem } from "../fs/memory.js";
import type { FsResult } from "../fs/types.js";
import { computeDrift } from "./drift.js";
import {
  DATA_ROOT,
  type Fixture,
  fixture,
  HOME,
  installedPath,
  LIBRARY,
  mkdirp,
  ok,
  SKILL_NAME,
  setupSkill,
  storePath,
} from "./testing.js";

function drift(setup: Fixture, extra: { skill?: string } = {}) {
  return computeDrift(setup.fs, DATA_ROOT, {
    adapters: setup.adapters,
    home: HOME,
    ...extra,
  });
}

/** Simulasi folder rusak: hanya isi Store claude-code yang tidak bisa dibaca. */
class BrokenClaudeStoreFs extends MemoryFileSystem {
  broken = false;

  override async read(targetPath: string): Promise<FsResult<Uint8Array>> {
    if (this.broken && targetPath.startsWith(installedPath("claude-code"))) {
      return { ok: false, error: { code: "io_error", path: targetPath, message: "rusak" } };
    }
    return super.read(targetPath);
  }
}

describe("computeDrift", () => {
  it("menandai clean bila hash Store sama dengan installedHash", async () => {
    const setup = await fixture();
    await setupSkill(setup, ["claude-code/global"]);

    const report = await drift(setup);

    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]).toMatchObject({
      status: "clean",
      storeId: "~/.claude/skills",
      skillName: SKILL_NAME,
      path: installedPath("claude-code"),
    });
    expect(report.staleCount).toBe(0);
  });

  it("menandai modified bila isi Store berubah (AC-8)", async () => {
    const setup = await fixture();
    await setupSkill(setup, ["claude-code/global"]);
    ok(await setup.fs.write(path.join(installedPath("claude-code"), "SKILL.md"), "# diubah\n"));

    const report = await drift(setup);

    expect(report.entries[0]).toMatchObject({ status: "modified" });
    expect(report.staleCount).toBe(1);
  });

  it("menandai missing bila direktori Store hilang (AC-12)", async () => {
    const setup = await fixture();
    await setupSkill(setup, ["claude-code/global"]);
    ok(await setup.fs.remove(installedPath("claude-code"), { recursive: true }));

    const report = await drift(setup);

    expect(report.entries[0]).toMatchObject({ status: "missing" });
    expect(report.entries[0]?.storeHash).toBeUndefined();
  });

  it("melaporkan direktori asing di Store sebagai unmanaged", async () => {
    const setup = await fixture();
    await setupSkill(setup, ["claude-code/global"]);
    const asing = path.join(storePath("claude-code"), "skill-asing");
    await mkdirp(setup.fs, asing);
    ok(await setup.fs.write(path.join(asing, "SKILL.md"), "# asing\n"));

    const report = await drift(setup);

    const unmanaged = report.entries.filter((entry) => entry.status === "unmanaged");
    expect(unmanaged).toHaveLength(1);
    expect(unmanaged[0]).toMatchObject({ storeId: "~/.claude/skills", path: asing });
  });

  it("menghitung Target yang tertinggal dari Library", async () => {
    const setup = await fixture();
    await setupSkill(setup, ["claude-code/global", "opencode/global"]);
    ok(
      await setup.fs.write(path.join(installedPath("claude-code"), "SKILL.md"), "# versi Store\n"),
    );

    const report = await drift(setup);

    expect(report.staleCount).toBe(1);
    const [claude, opencode] = report.entries;
    expect(claude).toMatchObject({ status: "modified", behindLibrary: true });
    expect(opencode).toMatchObject({ status: "clean", behindLibrary: false });
  });

  it("menghitung tertinggal walau Store masih cocok dengan installedHash", async () => {
    const setup = await fixture();
    await setupSkill(setup, ["claude-code/global"]);
    const librarySkillDir = path.join(LIBRARY, SKILL_NAME);
    ok(await setup.fs.write(path.join(librarySkillDir, "SKILL.md"), "# Library baru\n"));
    const newLibraryHash = ok(await contentHash(setup.fs, librarySkillDir));
    const { state } = await loadState(setup.fs, DATA_ROOT);
    ok(
      await saveState(setup.fs, DATA_ROOT, {
        ...state,
        library: state.library.map((skill) => ({ ...skill, contentHash: newLibraryHash })),
      }),
    );

    const report = await drift(setup);

    expect(report.entries[0]).toMatchObject({ status: "clean", behindLibrary: true });
    expect(report.staleCount).toBe(1);
  });

  it("menyaring per skill bila diminta", async () => {
    const setup = await fixture();
    await setupSkill(setup, ["claude-code/global"]);
    await mkdirp(setup.fs, path.join(storePath("claude-code"), "skill-asing"));

    const report = await drift(setup, { skill: SKILL_NAME });

    expect(report.entries.map((entry) => entry.status)).toEqual(["clean"]);
  });

  it("satu folder rusak tidak menggagalkan seluruh laporan", async () => {
    const brokenFs = new BrokenClaudeStoreFs();
    const setup = await fixture({ fs: brokenFs });
    await setupSkill(setup, ["claude-code/global", "opencode/global"]);
    brokenFs.broken = true;

    const report = await drift(setup);

    expect(report.entries).toHaveLength(2);
    expect(report.entries[0]).toMatchObject({
      status: "modified",
      error: { code: "io_error" },
    });
    expect(report.entries[1]).toMatchObject({ status: "clean" });
  });
});
