/**
 * AC-8 (drift, restore, adopt) dan `doctor` (spec §10.5, §14, AC-12).
 *
 * Modul `src/maintenance/*` berasal dari ticket 08 dan BELUM ada di
 * `feat/v0.1` saat ticket 11 dikerjakan. Selama modulnya belum ada, seluruh
 * suite di bawah di-SKIP dengan penanda "[menunggu ticket 08]" yang terlihat di
 * output test — bukan disembunyikan di dalam try/catch. Begitu ticket 08 masuk,
 * penanda hilang sendiri dan test langsung menguji implementasinya.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Adapter } from "../../src/adapters/index.js";
import { SkillManagerError } from "../../src/core/errors.js";
import { contentHash } from "../../src/core/hash.js";
import { loadState } from "../../src/core/state.js";
import { TEMP_PREFIX } from "../../src/fs/atomic.js";
import type { FileSystem } from "../../src/fs/types.js";
import { installSkill } from "../../src/install/install.js";
import { importFolderSkill } from "../../src/library/import-folder.js";
import { createHarness, FIXTURES, type IntegrationHarness, ok } from "./harness.js";

interface DriftEntry {
  readonly status: "clean" | "modified" | "missing" | "unmanaged";
  readonly storeId: string;
  readonly path: string;
  readonly skillName?: string;
  readonly installedHash?: string;
  readonly storeHash?: string;
  readonly behindLibrary?: boolean;
}

interface DriftReport {
  readonly entries: readonly DriftEntry[];
  readonly staleCount: number;
}

interface DoctorReport {
  readonly missing: readonly DriftEntry[];
  readonly unmanaged: readonly DriftEntry[];
  readonly tempDirs: readonly string[];
  readonly stale: readonly DriftEntry[];
}

interface TargetResultLike {
  readonly targetId: string;
  readonly ok: boolean;
}

interface MaintenanceApi {
  computeDrift(
    fs: FileSystem,
    dataRoot: string,
    options: { adapters: readonly Adapter[]; skill?: string; home?: string },
  ): Promise<DriftReport>;
  syncSkill(options: {
    fs: FileSystem;
    dataRoot: string;
    adapters: readonly Adapter[];
    skill: string;
    action: "restore" | "adopt";
    targets?: readonly string[];
    confirm: boolean;
    home?: string;
  }): Promise<readonly TargetResultLike[]>;
  runDoctor(
    fs: FileSystem,
    dataRoot: string,
    options: { adapters: readonly Adapter[]; home?: string },
  ): Promise<DoctorReport>;
}

const MODULE_SPECIFIERS = [
  "../../src/maintenance/drift.js",
  "../../src/maintenance/sync.js",
  "../../src/maintenance/doctor.js",
] as const;

/** Cek keberadaan modul ticket 08 SEBELUM mengimpor; skip harus terlihat. */
const TERSEDIA = MODULE_SPECIFIERS.every((specifier) =>
  existsSync(fileURLToPath(new URL(specifier.replace(/\.js$/u, ".ts"), import.meta.url))),
);

const PENANDA = TERSEDIA ? "" : "[menunggu ticket 08] ";

async function muatMaintenance(): Promise<MaintenanceApi | undefined> {
  if (!TERSEDIA) {
    return undefined;
  }
  const [driftSpecifier, syncSpecifier, doctorSpecifier] = MODULE_SPECIFIERS;
  const drift = (await import(driftSpecifier)) as Pick<MaintenanceApi, "computeDrift">;
  const sync = (await import(syncSpecifier)) as Pick<MaintenanceApi, "syncSkill">;
  const doctor = (await import(doctorSpecifier)) as Pick<MaintenanceApi, "runDoctor">;
  return {
    computeDrift: drift.computeDrift,
    syncSkill: sync.syncSkill,
    runDoctor: doctor.runDoctor,
  };
}

const CLAUDE_STORE = "~/.claude/skills";
const OPENCODE_STORE = "~/.config/opencode/skills";

describe.skipIf(!TERSEDIA)(`${PENANDA}AC-8 drift, restore, adopt, dan doctor`, () => {
  let harness: IntegrationHarness;
  let adapters: readonly Adapter[];
  let api: MaintenanceApi;
  let skillName: string;
  let claudeSkillDir: string;
  let opencodeSkillDir: string;

  beforeEach(async () => {
    harness = await createHarness("maintenance");
    adapters = await harness.adapters();
    api = (await muatMaintenance()) as MaintenanceApi;

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
  async function ubahStore(storeDir: string): Promise<void> {
    ok(await harness.fs.write(path.join(storeDir, "SKILL.md"), "# diubah user\n"));
  }

  it("AC-8 mengubah file di Store menghasilkan status modified", async () => {
    await ubahStore(claudeSkillDir);

    const report = await api.computeDrift(harness.fs, harness.dataRoot, {
      adapters,
      skill: skillName,
      home: harness.home,
    });

    const claude = report.entries.find((entry) => entry.storeId === CLAUDE_STORE);
    expect(claude?.status).toBe("modified");
    expect(claude?.storeHash).not.toBe(claude?.installedHash);
    expect(claude?.installedHash).toBe(
      (await loadState(harness.fs, harness.dataRoot)).state.installations[0]?.installedHash,
    );

    const opencode = report.entries.find((entry) => entry.storeId === OPENCODE_STORE);
    expect(opencode?.status).toBe("clean");
  });

  it("AC-8 restore mengembalikan isi Store, dan tanpa konfirmasi tidak menimpa", async () => {
    await ubahStore(claudeSkillDir);

    const tanpaKonfirmasi = await api
      .syncSkill({
        fs: harness.fs,
        dataRoot: harness.dataRoot,
        adapters,
        skill: skillName,
        action: "restore",
        confirm: false,
        home: harness.home,
      })
      .catch((error: unknown) => error);
    expect(tanpaKonfirmasi).toBeInstanceOf(SkillManagerError);
    expect(ok(await harness.fs.readText(path.join(claudeSkillDir, "SKILL.md")))).toBe(
      "# diubah user\n",
    );

    const results = await api.syncSkill({
      fs: harness.fs,
      dataRoot: harness.dataRoot,
      adapters,
      skill: skillName,
      action: "restore",
      confirm: true,
      home: harness.home,
    });
    expect(results.every((result) => result.ok)).toBe(true);

    expect(ok(await contentHash(harness.fs, claudeSkillDir))).toBe(
      ok(await contentHash(harness.fs, harness.libraryDir(skillName))),
    );
    const setelah = await api.computeDrift(harness.fs, harness.dataRoot, {
      adapters,
      skill: skillName,
      home: harness.home,
    });
    expect(setelah.entries.every((entry) => entry.status === "clean")).toBe(true);
  });

  it("AC-8 adopt memperbarui hash Library mengikuti isi Store", async () => {
    await ubahStore(opencodeSkillDir);
    const storeHash = ok(await contentHash(harness.fs, opencodeSkillDir));

    const results = await api.syncSkill({
      fs: harness.fs,
      dataRoot: harness.dataRoot,
      adapters,
      skill: skillName,
      action: "adopt",
      confirm: true,
      home: harness.home,
    });
    expect(results.every((result) => result.ok)).toBe(true);

    const { state } = await loadState(harness.fs, harness.dataRoot);
    expect(state.library[0]?.contentHash).toBe(storeHash);

    const setelah = await api.computeDrift(harness.fs, harness.dataRoot, {
      adapters,
      skill: skillName,
      home: harness.home,
    });
    expect(setelah.entries.find((entry) => entry.storeId === OPENCODE_STORE)?.status).toBe("clean");
  });

  it("doctor melaporkan sisa direktori .skill-manager-tmp-* di Store", async () => {
    const sisa = path.join(path.dirname(claudeSkillDir), `${TEMP_PREFIX}sisa-proses-mati`);
    ok(await harness.fs.mkdir(sisa, { recursive: true }));
    ok(await harness.fs.write(path.join(sisa, "SKILL.md"), "# setengah jadi\n"));

    const report = await api.runDoctor(harness.fs, harness.dataRoot, {
      adapters,
      home: harness.home,
    });

    expect(report.tempDirs.some((dir) => dir.includes(`${TEMP_PREFIX}sisa-proses-mati`))).toBe(
      true,
    );
    expect(report.missing).toEqual([]);
    expect(report.unmanaged.map((entry) => entry.path)).not.toContain(sisa);
  });
});
