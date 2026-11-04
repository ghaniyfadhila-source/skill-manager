/**
 * AC-8 (drift, restore, adopt) dan `doctor` (spec §10.5, §14, AC-12), diuji
 * end-to-end di atas direktori sementara: impor -> pasang -> ubah Store ->
 * hitung drift -> sinkron -> doctor.
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Adapter } from "../../src/adapters/index.js";
import { SkillManagerError } from "../../src/core/errors.js";
import { contentHash } from "../../src/core/hash.js";
import { loadState } from "../../src/core/state.js";
import { TEMP_PREFIX } from "../../src/fs/atomic.js";
import { installSkill } from "../../src/install/install.js";
import { importFolderSkill } from "../../src/library/import-folder.js";
import { runDoctor } from "../../src/maintenance/doctor.js";
import { computeDrift } from "../../src/maintenance/drift.js";
import { syncSkill } from "../../src/maintenance/sync.js";
import { createHarness, FIXTURES, type IntegrationHarness, ok } from "./harness.js";

const CLAUDE_STORE = "~/.claude/skills";
const OPENCODE_STORE = "~/.config/opencode/skills";

/** Nama entri Store yang memakai prefix direktori sementara (spec §14). */
async function tempEntries(harness: IntegrationHarness, dir: string): Promise<string[]> {
  const listing = await harness.fs.readdir(dir);
  if (!listing.ok) {
    return [];
  }
  return listing.value.map((entry) => entry.name).filter((name) => name.startsWith(TEMP_PREFIX));
}

describe("AC-8 drift, restore, adopt, dan doctor", () => {
  let harness: IntegrationHarness;
  let adapters: readonly Adapter[];
  let skillName: string;
  let claudeSkillDir: string;
  let opencodeSkillDir: string;

  beforeEach(async () => {
    harness = await createHarness("maintenance");
    adapters = await harness.adapters();

    const source = await harness.copyFixture(FIXTURES.tipeA);
    skillName = (await importFolderSkill(harness.fs, harness.dataRoot, { sourceDir: source })).skill
      .name;
    await installSkill({
      fs: harness.fs,
      dataRoot: harness.dataRoot,
      adapters,
      skill: skillName,
      targets: ["claude-code/global", "opencode/global"],
      home: harness.home,
    });

    claudeSkillDir = harness.storeSkillPath(CLAUDE_STORE, skillName);
    opencodeSkillDir = harness.storeSkillPath(OPENCODE_STORE, skillName);
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  /** Ubah isi salinan di Store, meniru user yang mengedit langsung. */
  async function ubahStore(storeDir: string, isi = "# diubah user\n"): Promise<void> {
    ok(await harness.fs.write(path.join(storeDir, "SKILL.md"), isi));
  }

  function drift(skill?: string) {
    return computeDrift(harness.fs, harness.dataRoot, {
      adapters,
      home: harness.home,
      ...(skill === undefined ? {} : { skill }),
    });
  }

  it("AC-8 mengubah file di Store menghasilkan status modified; Store lain tetap clean", async () => {
    await ubahStore(claudeSkillDir);

    const report = await drift(skillName);

    const claude = report.entries.find((entry) => entry.storeId === CLAUDE_STORE);
    expect(claude?.status).toBe("modified");
    expect(claude?.storeHash).not.toBe(claude?.installedHash);
    expect(claude?.path).toBe(claudeSkillDir);
    expect(report.entries.find((entry) => entry.storeId === OPENCODE_STORE)?.status).toBe("clean");
    expect(report.staleCount).toBe(1);

    const { state } = await loadState(harness.fs, harness.dataRoot);
    expect(claude?.installedHash).toBe(
      state.installations.find((entry) => entry.storeId === CLAUDE_STORE)?.installedHash,
    );
  });

  it("AC-8 restore mengembalikan isi Store, dan tanpa konfirmasi tidak ada penimpaan", async () => {
    await ubahStore(claudeSkillDir);

    const tanpaKonfirmasi = await syncSkill({
      fs: harness.fs,
      dataRoot: harness.dataRoot,
      adapters,
      skill: skillName,
      action: "restore",
      confirm: false,
      home: harness.home,
    }).catch((error: unknown) => error);

    expect(tanpaKonfirmasi).toBeInstanceOf(SkillManagerError);
    expect((tanpaKonfirmasi as SkillManagerError).code).toBe("confirmation_required");
    expect(ok(await harness.fs.readText(path.join(claudeSkillDir, "SKILL.md")))).toBe(
      "# diubah user\n",
    );

    const results = await syncSkill({
      fs: harness.fs,
      dataRoot: harness.dataRoot,
      adapters,
      skill: skillName,
      action: "restore",
      confirm: true,
      home: harness.home,
    });
    expect(results.map((result) => result.ok)).toEqual([true, true]);

    expect(ok(await contentHash(harness.fs, claudeSkillDir))).toBe(
      ok(await contentHash(harness.fs, harness.libraryDir(skillName))),
    );
    expect((await drift(skillName)).entries.every((entry) => entry.status === "clean")).toBe(true);

    // Backup-swap tidak boleh menyisakan staging maupun backup di Store mana pun.
    for (const storeDir of [claudeSkillDir, opencodeSkillDir]) {
      const sisa = await tempEntries(harness, path.dirname(storeDir));
      expect(sisa.filter((name) => name.startsWith(`${TEMP_PREFIX}restore-`))).toEqual([]);
      expect(sisa.filter((name) => name.startsWith(`${TEMP_PREFIX}backup-`))).toEqual([]);
      expect(sisa).toEqual([]);
    }
  });

  it("AC-8 adopt memperbarui hash Library mengikuti isi Store", async () => {
    await ubahStore(opencodeSkillDir);
    const storeHash = ok(await contentHash(harness.fs, opencodeSkillDir));

    const results = await syncSkill({
      fs: harness.fs,
      dataRoot: harness.dataRoot,
      adapters,
      skill: skillName,
      action: "adopt",
      targets: ["opencode/global"],
      confirm: true,
      home: harness.home,
    });
    expect(results.every((result) => result.ok)).toBe(true);

    const { state } = await loadState(harness.fs, harness.dataRoot);
    expect(state.library[0]?.contentHash).toBe(storeHash);
    expect(
      (await drift(skillName)).entries.find((entry) => entry.storeId === OPENCODE_STORE)?.status,
    ).toBe("clean");
  });

  it("adopt menolak saat dua Store berisi berbeda (satu Library tidak boleh punya dua isi)", async () => {
    await ubahStore(claudeSkillDir, "# diubah di [CC]\n");
    await ubahStore(opencodeSkillDir, "# diubah di opencode\n");

    const results = await syncSkill({
      fs: harness.fs,
      dataRoot: harness.dataRoot,
      adapters,
      skill: skillName,
      action: "adopt",
      confirm: true,
      home: harness.home,
    });

    expect(results.map((result) => result.ok)).toEqual([true, false]);
    expect(results[1]).toMatchObject({ ok: false, error: { code: "adopt_conflict" } });
  });

  it("doctor melaporkan sisa direktori .skill-manager-tmp-* tanpa menghapusnya", async () => {
    const sisa = path.join(path.dirname(claudeSkillDir), `${TEMP_PREFIX}sisa-proses-mati`);
    ok(await harness.fs.mkdir(sisa, { recursive: true }));
    ok(await harness.fs.write(path.join(sisa, "SKILL.md"), "# setengah jadi\n"));

    const report = await runDoctor(harness.fs, harness.dataRoot, {
      adapters,
      home: harness.home,
    });

    expect(report.tempDirs.some((dir) => dir.includes(`${TEMP_PREFIX}sisa-proses-mati`))).toBe(
      true,
    );
    expect(report.missing).toEqual([]);
    expect(report.unmanaged.map((entry) => entry.path)).not.toContain(sisa);

    // doctor hanya membaca; direktori sisa dibiarkan untuk dibersihkan eksplisit.
    expect(await harness.fs.exists(sisa)).toBe(true);
  });

  it("doctor melaporkan Installation yang direktorinya hilang dan direktori asing di Store", async () => {
    ok(await harness.fs.remove(claudeSkillDir, { recursive: true }));
    const asing = path.join(path.dirname(opencodeSkillDir), "skill-asing");
    ok(await harness.fs.mkdir(asing, { recursive: true }));
    ok(await harness.fs.write(path.join(asing, "SKILL.md"), "# asing\n"));

    const report = await runDoctor(harness.fs, harness.dataRoot, {
      adapters,
      home: harness.home,
    });

    expect(report.missing.map((entry) => entry.storeId)).toEqual([CLAUDE_STORE]);
    expect(report.unmanaged.map((entry) => entry.skillName)).toEqual(["skill-asing"]);
    expect(report.stale).toEqual([]);
    expect(report.tempDirs).toEqual([]);
  });

  /**
   * BATAS v0.1 yang sengaja didokumentasikan — bukan bug yang belum diperbaiki.
   *
   * `computeDrift` menjawab "apakah Store sesuai yang dicatat", bukan "apakah
   * Library masih utuh". Dua pertanyaan berbeda, dan v0.1 hanya menjawab yang
   * pertama. Test ini mengunci perilaku itu apa adanya: bila celah ini ditutup,
   * test ini HARUS gagal dan kontraknya diperbarui secara sadar.
   */
  it("drift tidak melaporkan isi Library yang hilang (batas v0.1)", async () => {
    ok(await harness.fs.remove(harness.libraryDir(skillName), { recursive: true }));

    const report = await drift(skillName);
    expect(report.entries.map((entry) => entry.status)).toEqual(["clean", "clean"]);
    expect(report.staleCount).toBe(0);

    const doctor = await runDoctor(harness.fs, harness.dataRoot, {
      adapters,
      home: harness.home,
    });
    expect(doctor.missing).toEqual([]);

    const restore = await syncSkill({
      fs: harness.fs,
      dataRoot: harness.dataRoot,
      adapters,
      skill: skillName,
      action: "restore",
      confirm: true,
      home: harness.home,
    }).catch((error: unknown) => error);

    expect(restore).toBeInstanceOf(SkillManagerError);
    expect((restore as SkillManagerError).code).toBe("skill_not_found");
  });
});
