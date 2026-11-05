import path from "node:path";
import { listStores } from "../adapters/index.js";
import type { Adapter } from "../adapters/manifest.js";
import { libraryRoot } from "../core/paths.js";
import { loadState } from "../core/state.js";
import { TEMP_PREFIX } from "../fs/atomic.js";
import { removeWithinStore } from "../fs/guard.js";
import type { FileSystem } from "../fs/types.js";
import { computeDrift, type DriftEntry } from "./drift.js";

export interface DoctorOptions {
  readonly adapters: readonly Adapter[];
  readonly home?: string;
  readonly platform?: NodeJS.Platform;
}

/** Bentuk persis kontrak `GET /api/doctor` (kontrak §7). */
export interface DoctorReport {
  /** Installation yang direktorinya hilang. */
  readonly missing: readonly DriftEntry[];
  /** Direktori Store yang tidak tercatat sebagai Installation. */
  readonly unmanaged: readonly DriftEntry[];
  /** Sisa direktori sementara `.skill-manager-tmp-*` (spec §14). */
  readonly tempDirs: readonly string[];
  /** Installation yang hash Store-nya berbeda dari hash Library saat ini. */
  readonly stale: readonly DriftEntry[];
  /**
   * Skill yang tercatat di state tetapi foldernya sudah tidak ada di Library.
   *
   * `missing` hanya melihat Store, jadi tanpa ini Library yang hilang tidak
   * pernah dilaporkan padahal setiap pemasangan ulang akan gagal. Isi Library
   * tidak bisa dipulihkan dari Store (Store adalah salinan, bukan sumber), jadi
   * laporan ini murni pemberitahuan.
   */
  readonly libraryMissing: readonly LibraryMissingEntry[];
}

/** Satu entri Library yang foldernya hilang. */
export interface LibraryMissingEntry {
  readonly skillId: string;
  readonly name: string;
  /** Path folder Library yang seharusnya ada. */
  readonly path: string;
}

/** Sisa direktori sementara di setiap Store; hanya membaca. */
async function tempDirectories(
  fs: FileSystem,
  options: DoctorOptions,
): Promise<{ readonly storePath: string; readonly dir: string }[]> {
  const stores = listStores(options.adapters, {
    home: options.home,
    platform: options.platform,
  });
  const found: { storePath: string; dir: string }[] = [];
  for (const store of stores) {
    const listing = await fs.readdir(store.path);
    if (!listing.ok) {
      continue;
    }
    for (const entry of listing.value) {
      if (entry.kind === "directory" && entry.name.startsWith(TEMP_PREFIX)) {
        found.push({ storePath: store.path, dir: path.join(store.path, entry.name) });
      }
    }
  }
  return found;
}

/**
 * Skill di state yang foldernya sudah tidak ada di Library. Diperiksa terpisah
 * dari drift karena drift membandingkan Store dengan `contentHash` yang tercatat,
 * bukan dengan isi Library yang sebenarnya.
 */
async function missingLibraryEntries(
  fs: FileSystem,
  dataRoot: string,
): Promise<LibraryMissingEntry[]> {
  const { state } = await loadState(fs, dataRoot);
  const root = libraryRoot(dataRoot);
  const found: LibraryMissingEntry[] = [];
  for (const skill of state.library) {
    const dir = path.join(root, skill.dirName);
    const stat = await fs.stat(dir);
    if (!stat.ok || stat.value.kind !== "directory") {
      found.push({ skillId: skill.id, name: skill.name, path: dir });
    }
  }
  return found;
}
/**
 * Periksa kesehatan Library/Store (spec §10.7, AC-12). **Hanya membaca**:
 * tidak ada direktori yang dibuat, diubah, atau dihapus. Perbaikan sisa temp
 * ada di `cleanTempDirs` supaya doctor selalu aman dipanggil kapan saja.
 */
export async function runDoctor(
  fs: FileSystem,
  dataRoot: string,
  options: DoctorOptions,
): Promise<DoctorReport> {
  const drift = await computeDrift(fs, dataRoot, options);
  const tempDirs = (await tempDirectories(fs, options)).map((entry) => entry.dir);
  return {
    missing: drift.entries.filter((entry) => entry.status === "missing"),
    unmanaged: drift.entries.filter((entry) => entry.status === "unmanaged"),
    stale: drift.entries.filter((entry) => entry.behindLibrary === true),
    tempDirs,
    libraryMissing: await missingLibraryEntries(fs, dataRoot),
  };
}

/**
 * Bersihkan sisa direktori sementara di Store (spec §14). Hanya entri dengan
 * prefix `TEMP_PREFIX` yang disentuh; skill asli dan folder lain dibiarkan.
 * Mengembalikan path yang berhasil dihapus; kegagalan satu entri tidak
 * membatalkan entri lain.
 */
export async function cleanTempDirs(
  fs: FileSystem,
  _dataRoot: string,
  options: DoctorOptions,
): Promise<readonly string[]> {
  const removed: string[] = [];
  const stores = listStores(options.adapters, {
    home: options.home,
    platform: options.platform,
  });
  for (const store of stores) {
    const listing = await fs.readdir(store.path);
    if (!listing.ok) {
      continue;
    }
    for (const entry of listing.value) {
      if (entry.kind !== "directory" || !entry.name.startsWith(TEMP_PREFIX)) {
        continue;
      }
      const dir = path.join(store.path, entry.name);
      const result = await removeWithinStore(fs, store.path, dir);
      if (result.ok) {
        removed.push(dir);
      }
    }
  }
  return removed;
}
