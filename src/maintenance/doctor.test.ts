import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadState } from "../core/state.js";
import { TEMP_PREFIX } from "../fs/atomic.js";
import { cleanTempDirs, runDoctor } from "./doctor.js";
import {
  DATA_ROOT,
  type Fixture,
  fixture,
  HOME,
  installedPath,
  mkdirp,
  ok,
  SKILL_NAME,
  setupSkill,
  storePath,
} from "./testing.js";

function doctor(setup: Fixture) {
  return runDoctor(setup.fs, DATA_ROOT, { adapters: setup.adapters, home: HOME });
}

function clean(setup: Fixture) {
  return cleanTempDirs(setup.fs, DATA_ROOT, { adapters: setup.adapters, home: HOME });
}

describe("runDoctor", () => {
  it("melaporkan Installation dengan direktori hilang (AC-12)", async () => {
    const setup = await fixture();
    await setupSkill(setup, ["claude-code/global"]);
    ok(await setup.fs.remove(installedPath("claude-code"), { recursive: true }));

    const report = await doctor(setup);

    expect(report.missing).toHaveLength(1);
    expect(report.missing[0]).toMatchObject({
      status: "missing",
      storeId: "~/.claude/skills",
      skillName: SKILL_NAME,
    });
    expect(report.unmanaged).toEqual([]);
    expect(report.tempDirs).toEqual([]);
  });

  it("melaporkan direktori unmanaged dan Installation tertinggal", async () => {
    const setup = await fixture();
    await setupSkill(setup, ["claude-code/global"]);
    const asing = path.join(storePath("claude-code"), "skill-asing");
    await mkdirp(setup.fs, asing);
    ok(await setup.fs.write(path.join(installedPath("claude-code"), "SKILL.md"), "# drift\n"));

    const report = await doctor(setup);

    expect(report.unmanaged.map((entry) => entry.path)).toEqual([asing]);
    expect(report.stale).toHaveLength(1);
    expect(report.stale[0]).toMatchObject({ status: "modified", behindLibrary: true });
    expect(report.missing).toEqual([]);
  });

  it("melaporkan sisa direktori sementara", async () => {
    const setup = await fixture();
    await setupSkill(setup, ["claude-code/global"]);
    const temp = path.join(storePath("claude-code"), `${TEMP_PREFIX}sisa`);
    await mkdirp(setup.fs, temp);

    const report = await doctor(setup);

    expect(report.tempDirs).toEqual([temp]);
    expect(report.unmanaged).toEqual([]);
  });

  it("read-only: tidak mengubah state maupun isi Store (AC-12)", async () => {
    const setup = await fixture();
    await setupSkill(setup, ["claude-code/global"]);
    const temp = path.join(storePath("claude-code"), `${TEMP_PREFIX}sisa`);
    await mkdirp(setup.fs, temp);
    ok(await setup.fs.write(path.join(installedPath("claude-code"), "SKILL.md"), "# drift\n"));
    const beforeState = await loadState(setup.fs, DATA_ROOT);

    await doctor(setup);

    const afterState = await loadState(setup.fs, DATA_ROOT);
    expect(afterState.state).toEqual(beforeState.state);
    expect(await setup.fs.exists(temp)).toBe(true);
    expect(ok(await setup.fs.readText(path.join(installedPath("claude-code"), "SKILL.md")))).toBe(
      "# drift\n",
    );
    expect(ok(await setup.fs.readdir(storePath("claude-code"))).map((entry) => entry.name)).toEqual(
      [`${TEMP_PREFIX}sisa`, SKILL_NAME],
    );
  });
});

describe("cleanTempDirs", () => {
  it("hanya menghapus direktori berawalan TEMP_PREFIX", async () => {
    const setup = await fixture();
    await setupSkill(setup, ["claude-code/global"]);
    const temp = path.join(storePath("claude-code"), `${TEMP_PREFIX}sisa`);
    const asing = path.join(storePath("claude-code"), "skill-asing");
    await mkdirp(setup.fs, temp);
    await mkdirp(setup.fs, asing);

    const removed = await clean(setup);

    expect(removed).toEqual([temp]);
    expect(await setup.fs.exists(temp)).toBe(false);
    expect(await setup.fs.exists(asing)).toBe(true);
    expect(await setup.fs.exists(path.join(installedPath("claude-code"), "SKILL.md"))).toBe(true);
  });
});
