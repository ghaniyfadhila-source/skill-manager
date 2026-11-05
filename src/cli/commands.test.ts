import path from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "../fs/memory.js";
import { FakeProcessRunner } from "../fs/process-fake.js";
import {
  captureError,
  DATA_ROOT,
  fixture,
  HOME,
  installedPath,
  ok,
  SKILL_NAME,
  setupSkill,
} from "../maintenance/testing.js";
import { addCommand, type CliDeps, listCommand, uninstallCommand } from "./commands.js";

function depsOf(setup: { fs: ReturnType<typeof Object> }): CliDeps {
  return {
    fs: setup.fs as never,
    runner: new FakeProcessRunner(),
    dataRoot: DATA_ROOT,
    home: HOME,
  };
}

describe("listCommand", () => {
  it("mengembalikan skill yang tercatat di Library", async () => {
    const setup = await fixture();
    await setupSkill(setup, []);

    const result = await listCommand(depsOf(setup));

    expect(result.skills.map((skill) => skill.name)).toEqual([SKILL_NAME]);
  });

  it("Library kosong menghasilkan daftar kosong, bukan galat", async () => {
    // State belum pernah ditulis: CLI harus tetap menjawab, bukan melempar.
    const result = await listCommand({
      fs: new MemoryFileSystem(),
      runner: new FakeProcessRunner(),
      dataRoot: DATA_ROOT,
      home: HOME,
    });

    expect(result.skills).toEqual([]);
  });
});

describe("addCommand", () => {
  it("memberi kode sumber_not_found untuk folder yang tidak ada", async () => {
    const setup = await fixture();
    const error = await captureError(() => addCommand(depsOf(setup), path.join(HOME, "tidak-ada")));

    expect(error.code).toBe("source_not_found");
  });
});

describe("uninstallCommand", () => {
  it("mencabut skill dari Target dan mengembalikan hasil per Target", async () => {
    const setup = await fixture();
    await setupSkill(setup, ["claude-code/global"]);

    const result = await uninstallCommand(depsOf(setup), SKILL_NAME, {
      from: "claude-code/global",
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({ ok: true });
    expect(await setup.fs.exists(installedPath("claude-code"))).toBe(false);
  });

  it("memecah daftar Target berkoma dan memproses semuanya", async () => {
    const setup = await fixture();
    await setupSkill(setup, ["claude-code/global", "opencode/global"]);

    const result = await uninstallCommand(depsOf(setup), SKILL_NAME, {
      from: "claude-code/global, opencode/global",
    });

    expect(result.results.map((entry) => entry.targetId)).toEqual([
      "claude-code/global",
      "opencode/global",
    ]);
  });
});
