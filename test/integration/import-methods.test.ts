/**
 * AC-3 (spec §15, matriks §16): impor minimal dua skill berbeda tipe untuk
 * setiap metode — folder, zip, git — tanpa jaringan. Fixture ada di disk
 * (`test/fixtures/`), bukan digenerate di dalam src.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SkillManagerError } from "../../src/core/errors.js";
import { contentHash } from "../../src/core/hash.js";
import { loadState } from "../../src/core/state.js";
import { importFolderSkill } from "../../src/library/import-folder.js";
import { importGitSkill } from "../../src/library/import-git.js";
import { importZipSkill } from "../../src/library/import-zip.js";
import {
  createHarness,
  FIXTURES,
  FIXTURES_DIR,
  FixtureGitRunner,
  type IntegrationHarness,
  ok,
  zipFixture,
} from "./harness.js";

const COMMIT_TIPE_B = "1234567890abcdef1234567890abcdef12345678";
const COMMIT_TIPE_C = "abcdef0123456789abcdef0123456789abcdef01";
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;

async function capture(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("AC-3 impor lintas metode", () => {
  let harness: IntegrationHarness;

  beforeEach(async () => {
    harness = await createHarness("import");
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  it("impor folder: tipe A (markdown) dan tipe C (python + aset biner) masuk Library", async () => {
    const sourceA = await harness.copyFixture(FIXTURES.tipeA);
    const sourceC = await harness.copyFixture(FIXTURES.tipeC);

    const resultA = await importFolderSkill(harness.fs, harness.dataRoot, { sourceDir: sourceA });
    const resultC = await importFolderSkill(harness.fs, harness.dataRoot, { sourceDir: sourceC });

    expect(resultA.skill).toMatchObject({
      name: "tipeA-markdown",
      dirName: "tipeA-markdown",
      license: "MIT",
      source: { type: "folder", path: sourceA },
    });
    expect(resultC.skill).toMatchObject({
      name: "tipeC-python",
      source: { type: "folder", path: sourceC },
      license: "MIT",
    });
    for (const skill of [resultA.skill, resultC.skill]) {
      expect(skill.contentHash).toMatch(HASH_PATTERN);
      expect(skill.contentHash).toBe(
        ok(await contentHash(harness.fs, harness.libraryDir(skill.dirName))),
      );
    }

    // references/ ikut tersalin apa adanya.
    expect(
      ok(
        await harness.fs.readText(
          path.join(harness.libraryDir("tipeA-markdown"), "references", "checklist.md"),
        ),
      ),
    ).toContain("Checklist");

    // Aset biner harus identik byte-per-byte dengan fixture (bukan teks).
    const original = await readFile(path.join(FIXTURES_DIR, FIXTURES.tipeC, "assets", "logo.png"));
    const copied = await readFile(
      path.join(harness.libraryDir("tipeC-python"), "assets", "logo.png"),
    );
    expect(copied.equals(original)).toBe(true);
    expect(
      ok(
        await harness.fs.read(path.join(harness.libraryDir("tipeC-python"), "assets", "logo.png")),
      ),
    ).toEqual(new Uint8Array(original));
    expect(
      await harness.fs.readText(
        path.join(harness.libraryDir("tipeC-python"), "assets", "logo.png"),
      ),
    ).toMatchObject({ ok: false, error: { code: "invalid_utf8" } });

    const state = (await loadState(harness.fs, harness.dataRoot)).state;
    expect(state.library.map((entry) => entry.name).sort()).toEqual([
      "tipeA-markdown",
      "tipeC-python",
    ]);
  });

  it("impor zip: arsip dibuat dari fixture saat test, dua tipe masuk Library", async () => {
    const archiveA = await zipFixture(harness, FIXTURES.tipeA);
    const archiveB = await zipFixture(harness, FIXTURES.tipeB);

    const resultA = await importZipSkill(harness.fs, harness.dataRoot, { zipPath: archiveA });
    const resultB = await importZipSkill(harness.fs, harness.dataRoot, { zipPath: archiveB });

    expect(resultA.skill.source).toEqual({ type: "zip", path: archiveA });
    expect(resultB.skill.source).toEqual({ type: "zip", path: archiveB });
    expect(resultB.skill.name).toBe("tipeB-scripts");
    expect(resultB.skill.contentHash).toBe(
      ok(await contentHash(harness.fs, harness.libraryDir("tipeB-scripts"))),
    );

    expect(
      ok(await harness.fs.readText(path.join(harness.libraryDir("tipeB-scripts"), "package.json"))),
    ).toContain("kleur");
    expect(
      ok(
        await harness.fs.readText(
          path.join(harness.libraryDir("tipeA-markdown"), "references", "panduan.md"),
        ),
      ),
    ).toContain("Panduan");
  });

  it("impor git: clone palsu menyalin fixture tanpa jaringan, provenance mencatat url/ref/commit", async () => {
    const urlB = "https://contoh.invalid/tipeB.git";
    const urlC = "https://contoh.invalid/tipeC.git";
    const runner = new FixtureGitRunner()
      .repo(urlB, FIXTURES.tipeB, COMMIT_TIPE_B)
      .repo(urlC, FIXTURES.tipeC, COMMIT_TIPE_C);

    const resultB = await importGitSkill(harness.fs, harness.dataRoot, runner, {
      url: urlB,
      ref: "main",
      tempRoot: harness.base,
      newTempDirName: () => "clone-b",
    });
    const resultC = await importGitSkill(harness.fs, harness.dataRoot, runner, {
      url: urlC,
      tempRoot: harness.base,
      newTempDirName: () => "clone-c",
    });

    expect(resultB.skill.source).toEqual({
      type: "git",
      url: urlB,
      ref: "main",
      commit: COMMIT_TIPE_B,
    });
    expect(resultC.skill.source).toEqual({
      type: "git",
      url: urlC,
      ref: "HEAD",
      commit: COMMIT_TIPE_C,
    });
    expect(resultC.skill.name).toBe("tipeC-python");
    expect(resultC.skill.contentHash).toBe(
      ok(await contentHash(harness.fs, harness.libraryDir("tipeC-python"))),
    );

    // Hanya git yang dipanggil, dan direktori sementara clone sudah dibersihkan.
    expect(runner.nonGitCalls).toEqual([]);
    expect(runner.calls.map((call) => call.args[0])).toContain("clone");
    expect(await harness.fs.exists(path.join(harness.base, "clone-b"))).toBe(false);
    expect(await harness.fs.exists(path.join(harness.base, "clone-c"))).toBe(false);
  });

  it("tabrakan nama: skill yang sama diimpor lewat dua metode ditolak dan menyebut skill lama", async () => {
    const sourceA = await harness.copyFixture(FIXTURES.tipeA);
    const first = await importFolderSkill(harness.fs, harness.dataRoot, { sourceDir: sourceA });
    const hashBefore = ok(await contentHash(harness.fs, harness.libraryDir("tipeA-markdown")));
    const archiveA = await zipFixture(harness, FIXTURES.tipeA);

    const error = await capture(() =>
      importZipSkill(harness.fs, harness.dataRoot, { zipPath: archiveA }),
    );

    expect(error).toBeInstanceOf(SkillManagerError);
    expect((error as SkillManagerError).code).toBe("name_conflict");
    expect((error as SkillManagerError).message).toContain("tipeA-markdown");
    expect((error as SkillManagerError).message).toContain("sudah ada");

    const state = (await loadState(harness.fs, harness.dataRoot)).state;
    expect(state.library).toHaveLength(1);
    expect(state.library[0]?.id).toBe(first.skill.id);
    expect(ok(await contentHash(harness.fs, harness.libraryDir("tipeA-markdown")))).toBe(
      hashBefore,
    );
  });

  it("fixture rusak: tipe D (tanpa SKILL.md) dan tipe E (frontmatter rusak) ditolak tanpa menulis Library", async () => {
    const sourceD = await harness.copyFixture(FIXTURES.tipeD);
    const sourceE = await harness.copyFixture(FIXTURES.tipeE);

    const errorD = await capture(() =>
      importFolderSkill(harness.fs, harness.dataRoot, { sourceDir: sourceD }),
    );
    const errorE = await capture(() =>
      importFolderSkill(harness.fs, harness.dataRoot, { sourceDir: sourceE }),
    );

    expect((errorD as SkillManagerError).code).toBe("skill_md_missing");
    expect((errorE as SkillManagerError).code).toBe("frontmatter_invalid");
    expect(await harness.fs.exists(path.join(harness.dataRoot, "library"))).toBe(false);
    expect((await loadState(harness.fs, harness.dataRoot)).state.library).toEqual([]);
  });
});
