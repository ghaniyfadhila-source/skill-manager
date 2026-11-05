import { randomUUID } from "node:crypto";
import path from "node:path";
import { adapterCapability, listStores, resolveTarget } from "../adapters/index.js";
import type { Adapter } from "../adapters/manifest.js";
import { SkillManagerError } from "../core/errors.js";
import { contentHash } from "../core/hash.js";
import { libraryRoot } from "../core/paths.js";
import { loadState, saveState } from "../core/state.js";
import type {
  Installation,
  Skill,
  StateFile,
  Store,
  TargetError,
  TargetResult,
} from "../core/types.js";
import { type PopulateTempDirectory, TEMP_PREFIX, writeDirectoryAtomic } from "../fs/atomic.js";
import { guardStorePath, removeWithinStore } from "../fs/guard.js";
import type { FileSystem, FsError } from "../fs/types.js";

/** Aksi sinkron (spec §10.5). Tidak pernah berjalan otomatis. */
export type SyncAction = "restore" | "adopt";

export interface SyncOptions {
  readonly fs: FileSystem;
  readonly dataRoot: string;
  readonly adapters: readonly Adapter[];
  /** Nama atau id skill di Library. */
  readonly skill: string;
  readonly action: SyncAction;
  /**
   * Id Target yang disinkronkan; default semua Installation skill ini.
   * Urutan hasil mengikuti urutan ini.
   */
  readonly targets?: readonly string[];
  /**
   * Wajib `true`: restore menimpa perubahan user dan adopt mengubah hash
   * Library. Tanpa ini tidak ada satu pun file yang ditulis.
   */
  readonly confirm?: boolean;
  readonly home?: string;
  readonly platform?: NodeJS.Platform;
}

type PlanEntry =
  | {
      readonly targetId: string;
      readonly store: Store;
      readonly installation: Installation;
      readonly error?: undefined;
    }
  | { readonly targetId: string; readonly store?: undefined; readonly error: TargetError };

function fromFs(error: FsError): SkillManagerError {
  return new SkillManagerError({
    code: error.code,
    message: error.message,
    details: { path: error.path },
  });
}

function toTargetError(error: unknown): TargetError {
  if (error instanceof SkillManagerError) {
    return { code: error.code, message: error.message, details: error.details };
  }
  return {
    code: "io_error",
    message: error instanceof Error ? error.message : String(error),
  };
}

function installationKey(installation: Installation): string {
  return `${installation.skillId}::${installation.storeId}`;
}

/** Id Target yang memetakan ke Store ini, untuk laporan per Target. */
function targetIdForStore(adapters: readonly Adapter[], storeId: string): string | undefined {
  for (const adapter of adapters) {
    if (adapterCapability(adapter) !== "managed") {
      continue;
    }
    for (const store of adapter.stores) {
      if (store.path === storeId) {
        return `${adapter.id}/${store.scope}`;
      }
    }
  }
  return undefined;
}

function resolvePlan(
  options: SyncOptions,
  state: StateFile,
  skill: Skill,
  stores: ReadonlyMap<string, Store>,
): PlanEntry[] {
  const findInstallation = (storeId: string) =>
    state.installations.find(
      (installation) => installation.skillId === skill.id && installation.storeId === storeId,
    );

  if (options.targets !== undefined) {
    return options.targets.map((targetId) => {
      try {
        const target = resolveTarget(options.adapters, targetId);
        const store = stores.get(target.storeId);
        if (store === undefined) {
          throw new SkillManagerError({
            code: "unknown_store",
            message: `Store "${target.storeId}" untuk Target "${targetId}" tidak dikenal.`,
          });
        }
        const installation = findInstallation(store.id);
        if (installation === undefined) {
          throw new SkillManagerError({
            code: "installation_not_found",
            message: `Skill "${skill.name}" tidak tercatat terpasang di Store ${store.id}.`,
            details: { storeId: store.id, skillId: skill.id },
          });
        }
        return { targetId, store, installation };
      } catch (error) {
        return { targetId, error: toTargetError(error) };
      }
    });
  }

  // Default: semua Installation skill ini, dipetakan balik ke Id Target.
  return state.installations
    .filter((installation) => installation.skillId === skill.id)
    .map((installation) => {
      const store = stores.get(installation.storeId);
      const targetId =
        targetIdForStore(options.adapters, installation.storeId) ?? installation.storeId;
      if (store === undefined) {
        return {
          targetId,
          error: {
            code: "unknown_store",
            message: `Store "${installation.storeId}" tidak dikenal adapter.`,
          },
        };
      }
      return { targetId, store, installation };
    });
}

/** Store yang belum ada dibuat lebih dulu agar guard bisa me-realpath-nya. */
async function ensureStoreDirectory(fs: FileSystem, storePath: string): Promise<void> {
  const stat = await fs.stat(storePath);
  if (stat.ok) {
    if (stat.value.kind !== "directory") {
      throw new SkillManagerError({
        code: "not_a_directory",
        message: `Store ${storePath} bukan direktori.`,
        details: { path: storePath },
      });
    }
    return;
  }
  if (stat.error.code !== "not_found") {
    throw fromFs(stat.error);
  }
  const made = await fs.mkdir(storePath, { recursive: true });
  if (!made.ok) {
    throw fromFs(made.error);
  }
}

function populateFrom(fs: FileSystem, source: string): PopulateTempDirectory {
  return async (tempDir) => {
    const listing = await fs.readdir(source);
    if (!listing.ok) {
      return listing;
    }
    for (const entry of listing.value) {
      const copied = await fs.copy(path.join(source, entry.name), path.join(tempDir, entry.name));
      if (!copied.ok) {
        return copied;
      }
    }
    return { ok: true, value: undefined };
  };
}

/**
 * Ganti isi `destination` dengan hasil `populate` memakai pola backup-swap
 * (spec §14): isi baru dibangun di staging lebih dulu, target lama dipindah ke
 * backup, lalu ditukar. Bila penukaran gagal, backup dikembalikan sehingga
 * target tidak pernah dalam keadaan hilang.
 *
 * Dipakai dua arah: restore menulis Store dari Library, adopt menulis Library
 * dari Store. Keduanya memakai aturan yang sama persis.
 */
async function swapDirectory(
  fs: FileSystem,
  containerDir: string,
  destination: string,
  label: string,
  populate: PopulateTempDirectory,
): Promise<void> {
  // 1. Isi baru dibangun di staging di dalam container yang sama; salinan lama
  //    belum disentuh. Staging berada di volume yang sama agar rename atomik.
  const staging = path.join(containerDir, `${TEMP_PREFIX}${label}-${randomUUID()}`);
  const written = await writeDirectoryAtomic(fs, staging, populate);
  if (!written.ok) {
    throw fromFs(written.error);
  }

  // 2. Salinan lama dipindah ke backup.
  const backup = path.join(containerDir, `${TEMP_PREFIX}backup-${randomUUID()}`);
  const hadTarget = await fs.exists(destination);
  if (hadTarget) {
    const moved = await fs.rename(destination, backup);
    if (!moved.ok) {
      await fs.remove(staging, { recursive: true });
      throw fromFs(moved.error);
    }
  }

  // 3. staging -> target. Bila gagal, backup dikembalikan sehingga target
  //    berisi isi lama seperti sebelum sinkron.
  const swapped = await fs.rename(staging, destination);
  if (!swapped.ok) {
    if (hadTarget) {
      await fs.rename(backup, destination);
    }
    await fs.remove(staging, { recursive: true });
    throw fromFs(swapped.error);
  }

  // 4. Backup dibersihkan best-effort; sisa yang gagal dihapus (mis. crash)
  //    memakai prefix yang sama sehingga `doctor` melaporkannya.
  if (hadTarget) {
    await fs.remove(backup, { recursive: true });
  }
}

/** Kembalikan isi Store dari Library dengan pola backup-swap (spec §14). */
async function restoreOne(
  fs: FileSystem,
  skill: Skill,
  source: string,
  store: Store,
  installation: Installation,
): Promise<Installation> {
  await ensureStoreDirectory(fs, store.path);
  const destination = path.join(store.path, skill.dirName);
  const guarded = await guardStorePath(fs, store.path, destination);
  if (!guarded.ok) {
    throw fromFs(guarded.error);
  }
  const target = guarded.value.path;

  await swapDirectory(fs, store.path, target, "restore", populateFrom(fs, source));

  const hash = await contentHash(fs, target);
  if (!hash.ok) {
    throw fromFs(hash.error);
  }
  return { ...installation, installedHash: hash.value };
}

/**
 * Adopsi isi Store sebagai kebenaran baru: isi Library DIGANTI dengan isi Store
 * lalu hash-nya diperbarui.
 *
 * Menyalin isinya (bukan hanya hash-nya) penting: Library adalah sumber
 * kebenaran, jadi `contentHash` harus selalu menggambarkan isi folder yang
 * benar-benar ada. Bila hanya hash yang diperbarui, Library menyimpan isi lama
 * sambil mengklaim hash baru, dan pemasangan berikutnya menulis isi lama yang
 * hash-nya tidak cocok — drift muncul lagi tanpa ada yang mengubah apa pun.
 */
async function adoptOne(
  fs: FileSystem,
  dataRoot: string,
  skill: Skill,
  store: Store,
): Promise<string> {
  const destination = path.join(store.path, skill.dirName);
  const stat = await fs.stat(destination);
  if (!stat.ok) {
    throw new SkillManagerError({
      code: "drift_missing",
      message: `Isi ${destination} tidak ada; tidak ada yang bisa diadopsi.`,
      details: { path: destination, storeId: store.id },
    });
  }
  if (stat.value.kind !== "directory") {
    throw new SkillManagerError({
      code: "not_a_directory",
      message: `${destination} bukan direktori; tidak ada yang bisa diadopsi.`,
      details: { path: destination, storeId: store.id },
    });
  }
  // Isi Library diganti dengan isi Store memakai aturan tukar yang sama
  // seperti restore, sehingga Library tidak pernah setengah terganti.
  const libraryDir = libraryRoot(dataRoot);
  const made = await fs.mkdir(libraryDir, { recursive: true });
  if (!made.ok) {
    throw fromFs(made.error);
  }
  await swapDirectory(
    fs,
    libraryDir,
    path.join(libraryDir, skill.dirName),
    "adopt",
    populateFrom(fs, destination),
  );

  const hash = await contentHash(fs, path.join(libraryDir, skill.dirName));
  if (!hash.ok) {
    throw fromFs(hash.error);
  }
  return hash.value;
}

async function persist(
  fs: FileSystem,
  dataRoot: string,
  state: StateFile,
  skillId: string,
  libraryHash: string | undefined,
  installations: readonly Installation[],
): Promise<void> {
  if (installations.length === 0 && libraryHash === undefined) {
    return;
  }
  const replaced = new Set(installations.map(installationKey));
  const kept = state.installations.filter(
    (installation) => !replaced.has(installationKey(installation)),
  );
  const library =
    libraryHash === undefined
      ? state.library
      : state.library.map((skill) =>
          skill.id === skillId ? { ...skill, contentHash: libraryHash } : skill,
        );

  const saved = await saveState(fs, dataRoot, {
    ...state,
    library,
    installations: [...kept, ...installations],
  });
  if (!saved.ok) {
    throw new SkillManagerError({
      code: "state_write_failed",
      message: `Sinkron selesai tetapi state.json gagal ditulis: ${saved.error.message}`,
      details: saved.error,
    });
  }
}

/**
 * Sinkronkan satu skill ke beberapa Target (spec §10.5).
 *
 * - `restore`: salin ulang dari Library ke Store lalu perbarui `installedHash`.
 * - `adopt`: perbarui hash Library dan `installedHash` dari isi Store; tidak
 *   menyalin apa pun. Bila beberapa Target berbeda isinya, hanya hash pertama
 *   yang dipakai dan Target lain gagal dengan `adopt_conflict`.
 * - Wajib `confirm: true`; tanpa itu galat `confirmation_required` sebelum ada
 *   penulisan. Kegagalan satu Target tidak membatalkan Target lain (spec §14).
 */
export async function syncSkill(options: SyncOptions): Promise<readonly TargetResult[]> {
  const { fs, dataRoot } = options;
  if (options.confirm !== true) {
    throw new SkillManagerError({
      code: "confirmation_required",
      message:
        options.action === "restore"
          ? "Restore menimpa perubahan user di Store. Setujui dulu dengan confirm: true."
          : "Adopt mengubah hash Library. Setujui dulu dengan confirm: true.",
      details: { action: options.action },
    });
  }

  const { state } = await loadState(fs, dataRoot);
  const skill = state.library.find(
    (entry) => entry.name === options.skill || entry.id === options.skill,
  );
  if (skill === undefined) {
    throw new SkillManagerError({
      code: "skill_not_found",
      message: `Skill "${options.skill}" tidak ada di Library.`,
    });
  }

  let source = "";
  if (options.action === "restore") {
    source = path.join(libraryRoot(dataRoot), skill.dirName);
    const stat = await fs.stat(source);
    if (!stat.ok || stat.value.kind !== "directory") {
      throw new SkillManagerError({
        code: "skill_not_found",
        message: `Isi skill "${skill.name}" tidak ditemukan di Library (${source}).`,
        details: { path: source },
      });
    }
  }

  const stores = new Map(
    listStores(options.adapters, { home: options.home, platform: options.platform }).map(
      (store) => [store.id, store],
    ),
  );
  const plan = resolvePlan(options, state, skill, stores);

  const results: TargetResult[] = [];
  const updated: Installation[] = [];
  let libraryHash: string | undefined;

  for (const entry of plan) {
    if (entry.error !== undefined) {
      results.push({ targetId: entry.targetId, ok: false, error: entry.error });
      continue;
    }
    try {
      if (options.action === "restore") {
        const installation = await restoreOne(fs, skill, source, entry.store, entry.installation);
        updated.push(installation);
        results.push({ targetId: entry.targetId, ok: true, installation });
        continue;
      }

      const hash = await adoptOne(fs, dataRoot, skill, entry.store);
      if (libraryHash !== undefined && libraryHash !== hash) {
        throw new SkillManagerError({
          code: "adopt_conflict",
          message:
            "Isi Target lain berbeda; satu Library tidak bisa mengadopsi dua isi berbeda. " +
            "Adopsi Target ini secara terpisah setelah membereskan perbedaannya.",
          details: { storeId: entry.store.id, targetId: entry.targetId },
        });
      }
      libraryHash = hash;
      const installation = { ...entry.installation, installedHash: hash };
      updated.push(installation);
      results.push({ targetId: entry.targetId, ok: true, installation });
    } catch (error) {
      results.push({ targetId: entry.targetId, ok: false, error: toTargetError(error) });
    }
  }

  await persist(fs, dataRoot, state, skill.id, libraryHash, updated);
  return results;
}
