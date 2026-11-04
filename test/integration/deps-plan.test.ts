/**
 * AC-9 (spec §10.6, §15): skill dengan `package.json` menampilkan dependensi
 * dan perintah PERSIS yang akan dijalankan, dengan `--ignore-scripts` sebagai
 * default; tidak ada satu pun proses yang dijalankan saat rencana disusun.
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { depsRoot } from "../../src/core/paths.js";
import { IGNORE_SCRIPTS_FLAG, UV_REQUIREMENTS_ARGS } from "../../src/deps/detect.js";
import { planDependencies } from "../../src/deps/plan.js";
import { importFolderSkill } from "../../src/library/import-folder.js";
import { createHarness, FIXTURES, type IntegrationHarness, ok } from "./harness.js";

describe("AC-9 rencana dependensi", () => {
  let harness: IntegrationHarness;

  beforeEach(async () => {
    harness = await createHarness("deps");
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  /**
   * Bukti tidak ada eksekusi saat rencana disusun: `planDependencies` memang
   * tidak menerima ProcessRunner, dan direktori instalasi terisolasi tidak
   * dibuat. dataRoot tetap hanya berisi Library + state.json.
   */
  async function assertTanpaEksekusi(): Promise<void> {
    expect(await harness.fs.exists(depsRoot(harness.dataRoot))).toBe(false);
    expect(
      ok(await harness.fs.readdir(harness.dataRoot))
        .map((entry) => entry.name)
        .sort(),
    ).toEqual(["library", "state.json"]);
  }

  async function importFixture(fixture: keyof typeof FIXTURES): Promise<string> {
    const source = await harness.copyFixture(FIXTURES[fixture]);
    const { skill } = await importFolderSkill(harness.fs, harness.dataRoot, { sourceDir: source });
    return skill.name;
  }

  it("tipe B (package.json) menghasilkan npm install --ignore-scripts", async () => {
    const name = await importFixture("tipeB");

    const commands = ok(
      await planDependencies(harness.fs, harness.libraryDir(name), {
        dataRoot: harness.dataRoot,
        skillId: name,
      }),
    );

    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      kind: "npm",
      command: "npm",
      cwd: path.join(depsRoot(harness.dataRoot), name),
    });
    expect(commands[0]?.args).toEqual(["install", "--ignore-scripts"]);
    expect(commands[0]?.args).toContain(IGNORE_SCRIPTS_FLAG);
    expect(commands[0]?.dependencies).toEqual(["kleur", "picocolors"]);

    await assertTanpaEksekusi();
  });

  it("tipe C (requirements.txt) menghasilkan uv pip install -r requirements.txt", async () => {
    const name = await importFixture("tipeC");

    const commands = ok(
      await planDependencies(harness.fs, harness.libraryDir(name), {
        dataRoot: harness.dataRoot,
        skillId: name,
      }),
    );

    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      kind: "uv",
      command: "uv",
      cwd: path.join(depsRoot(harness.dataRoot), name),
    });
    expect(commands[0]?.args).toEqual(["pip", "install", "-r", "requirements.txt"]);
    expect(commands[0]?.args).toEqual([...UV_REQUIREMENTS_ARGS]);
    expect(commands[0]?.dependencies).toEqual(["pillow==10.4.0", "requests>=2.32.0"]);

    await assertTanpaEksekusi();
  });

  it("skill tanpa manifest dependensi tidak menghasilkan perintah", async () => {
    const name = await importFixture("tipeA");

    expect(
      ok(
        await planDependencies(harness.fs, harness.libraryDir(name), {
          dataRoot: harness.dataRoot,
          skillId: name,
        }),
      ),
    ).toEqual([]);
  });
});
