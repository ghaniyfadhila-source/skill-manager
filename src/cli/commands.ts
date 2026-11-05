import { homedir } from "node:os";
import path from "node:path";
import { recheck } from "../adapters/detect.js";
import { type Adapter, loadAdapters } from "../adapters/index.js";
import { SkillManagerError } from "../core/errors.js";
import { resolveDataRoot } from "../core/paths.js";
import { loadState } from "../core/state.js";
import { NodeFileSystem } from "../fs/node.js";
import type { ProcessRunner } from "../fs/process.js";
import { NodeProcessRunner } from "../fs/process-node.js";
import type { FileSystem } from "../fs/types.js";
import { installSkill } from "../install/install.js";
import { uninstallSkill } from "../install/uninstall.js";
import { importFolderSkill } from "../library/import-folder.js";
import { importGitSkill } from "../library/import-git.js";
import { importZipSkill } from "../library/import-zip.js";
import { runDoctor } from "../maintenance/doctor.js";
import { computeDrift } from "../maintenance/drift.js";
import { syncSkill } from "../maintenance/sync.js";

/** Dependensi perintah CLI; test menyuntikkan fs/runner/dataRoot palsu. */
export interface CliDeps {
  readonly fs: FileSystem;
  readonly runner: ProcessRunner;
  readonly dataRoot: string;
  readonly home: string;
}

/** Dependensi produksi. Dibuat lazy agar tidak ada I/O saat modul dimuat. */
export function defaultCliDeps(): CliDeps {
  return {
    fs: new NodeFileSystem(),
    runner: new NodeProcessRunner(),
    dataRoot: resolveDataRoot(),
    home: homedir(),
  };
}

async function adaptersOf(deps: CliDeps): Promise<readonly Adapter[]> {
  const { adapters } = await loadAdapters({ fs: deps.fs, dataRoot: deps.dataRoot });
  return adapters;
}

function splitTargets(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Deteksi harness yang terpasang (spec Â§10.1). */
export async function detectCommand(deps: CliDeps) {
  const { harnesses } = await recheck({
    fs: deps.fs,
    runner: deps.runner,
    dataRoot: deps.dataRoot,
    home: deps.home,
  });
  return { harnesses };
}

/**
 * Impor skill ke Library (spec Â§11 `add`). Jenis sumber ditentukan dari
 * bentuknya: URL http(s) = git, berkas `.zip` = zip, selain itu folder.
 */
export async function addCommand(deps: CliDeps, source: string, options: { ref?: string } = {}) {
  const isUrl = /^https?:\/\//i.test(source);
  if (isUrl) {
    const result = await importGitSkill(deps.fs, deps.dataRoot, deps.runner, {
      url: source,
      ...(options.ref === undefined ? {} : { ref: options.ref }),
    });
    return result;
  }

  const resolved = path.resolve(source);
  const stat = await deps.fs.stat(resolved);
  if (!stat.ok) {
    throw new SkillManagerError({
      code: "source_not_found",
      message: `Sumber tidak ditemukan: ${resolved}`,
      details: { path: resolved },
    });
  }

  if (stat.value.kind === "file") {
    return importZipSkill(deps.fs, deps.dataRoot, { zipPath: resolved });
  }
  return importFolderSkill(deps.fs, deps.dataRoot, { sourceDir: resolved });
}

/** Daftar skill di Library (spec Â§11 `list`). */
export async function listCommand(deps: CliDeps) {
  const { state } = await loadState(deps.fs, deps.dataRoot);
  return { skills: state.library };
}

/** Pasang skill ke satu atau lebih Target (spec Â§11 `install`). */
export async function installCommand(
  deps: CliDeps,
  skill: string,
  options: { to: string; shared?: boolean },
) {
  const adapters = await adaptersOf(deps);
  const results = await installSkill({
    fs: deps.fs,
    dataRoot: deps.dataRoot,
    adapters,
    skill,
    targets: splitTargets(options.to),
    // `--shared` adalah persetujuan eksplisit pada baris perintah, setara
    // menekan tombol konfirmasi di UI (AC-6).
    acknowledgeShared: options.shared === true,
    ...(options.shared === true ? { shared: true } : {}),
    home: deps.home,
  });
  return { results };
}

/** Cabut skill dari Target (spec Â§11 `uninstall`). */
export async function uninstallCommand(
  deps: CliDeps,
  skill: string,
  options: { from: string; force?: boolean; acknowledgeShared?: boolean },
) {
  const adapters = await adaptersOf(deps);
  const results = await uninstallSkill({
    fs: deps.fs,
    dataRoot: deps.dataRoot,
    adapters,
    skill,
    targets: splitTargets(options.from),
    force: options.force === true,
    acknowledgeShared: options.acknowledgeShared === true,
    home: deps.home,
  });
  return { results };
}

/**
 * Sinkronkan Installation yang drift (spec Â§11 `sync`). Tanpa `--skill`
 * seluruh skill yang tertinggal disinkronkan. Aksi bawaan `restore` (Library
 * adalah sumber kebenaran); `--adopt` membalik arahnya secara sadar.
 */
export async function syncCommand(
  deps: CliDeps,
  options: { skill?: string; adopt?: boolean } = {},
) {
  const adapters = await adaptersOf(deps);
  const action = options.adopt === true ? "adopt" : "restore";

  if (options.skill !== undefined) {
    const results = await syncSkill({
      fs: deps.fs,
      dataRoot: deps.dataRoot,
      adapters,
      skill: options.skill,
      action,
      confirm: true,
      home: deps.home,
    });
    return { results };
  }

  const drift = await computeDrift(deps.fs, deps.dataRoot, { adapters, home: deps.home });
  const names = new Set<string>();
  for (const entry of drift.entries) {
    if (entry.behindLibrary === true && entry.skillName !== undefined) {
      names.add(entry.skillName);
    }
  }

  const results: Awaited<ReturnType<typeof syncSkill>>[number][] = [];
  const failures: { skill: string; code: string; message: string }[] = [];
  for (const name of names) {
    try {
      results.push(
        ...(await syncSkill({
          fs: deps.fs,
          dataRoot: deps.dataRoot,
          adapters,
          skill: name,
          action,
          confirm: true,
          home: deps.home,
        })),
      );
    } catch (error) {
      // Satu skill gagal tidak menghentikan skill lain; kegagalannya dilaporkan.
      failures.push({
        skill: name,
        code: error instanceof SkillManagerError ? error.code : "sync_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { results, failures };
}

/** Laporan kesehatan Library/Store (spec Â§10.7). */
export async function doctorCommand(deps: CliDeps) {
  return runDoctor(deps.fs, deps.dataRoot, { adapters: await adaptersOf(deps), home: deps.home });
}
