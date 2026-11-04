import path from "node:path";
import { listStores, resolveTarget } from "../adapters/index.js";
import type { Adapter } from "../adapters/manifest.js";
import { SkillManagerError } from "../core/errors.js";
import { contentHash } from "../core/hash.js";
import { loadState, saveState } from "../core/state.js";
import type {
  Installation,
  Skill,
  StateFile,
  Store,
  TargetError,
  TargetResult,
} from "../core/types.js";
import { guardStorePath, removeWithinStore } from "../fs/guard.js";
import type { FileSystem, FsError } from "../fs/types.js";

export interface UninstallOptions {
  readonly fs: FileSystem;
  readonly dataRoot: string;
  readonly adapters: readonly Adapter[];
  /** Nama skill di Library (atau id-nya). */
  readonly skill: string;
  /** Id Target, mis. `"opencode/global"`; urutan hasil mengikuti urutan ini. */
  readonly targets: readonly string[];
  /**
   * Hapus meski hash di Store berbeda dari `installedHash` (drift). Default
   * `false`: drift selalu ditolak agar perubahan user tidak hilang diam-diam.
   */
  readonly force?: boolean;
  /** Default `os.homedir()`; bisa disuntikkan test. */
  readonly home?: string;
  readonly platform?: NodeJS.Platform;
}

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

/**
 * Skill yang dicabut hanya perlu entri Library (`dirName`), bukan isi folder
 * Library: Library tidak pernah disentuh, bahkan bila salinannya sudah hilang.
 */
async function findSkill(
  fs: FileSystem,
  dataRoot: string,
  name: string,
): Promise<{ skill: Skill; state: StateFile }> {
  const { state } = await loadState(fs, dataRoot);
  const skill = state.library.find((entry) => entry.name === name || entry.id === name);
  if (skill === undefined) {
    throw new SkillManagerError({
      code: "skill_not_found",
      message: `Skill "${name}" tidak ada di Library.`,
    });
  }
  return { skill, state };
}

/**
 * Cabut satu Installation (spec §10.4):
 * - Installation wajib tercatat; tanpa itu tidak ada yang boleh dihapus.
 * - Hash tujuan harus sama dengan `installedHash`; bila berbeda, tidak ada yang
 *   dihapus dan galat `drift_detected` membawa kedua hash agar UI bisa meminta
 *   keputusan user. `force: true` melewati pemeriksaan ini secara eksplisit.
 * - Direktori yang sudah hilang dianggap bersih: catatan usang tetap dibuang.
 * - Penghapusan selalu lewat `removeWithinStore` (realpath + guard Store).
 */
async function uninstallOne(
  fs: FileSystem,
  state: StateFile,
  skill: Skill,
  store: Store,
  force: boolean,
): Promise<Installation> {
  const installation = state.installations.find(
    (entry) => entry.skillId === skill.id && entry.storeId === store.id,
  );
  if (installation === undefined) {
    throw new SkillManagerError({
      code: "installation_not_found",
      message: `Skill "${skill.name}" tidak tercatat terpasang di Store ${store.id}.`,
      details: { storeId: store.id, skillId: skill.id },
    });
  }

  const destination = path.join(store.path, skill.dirName);
  const guarded = await guardStorePath(fs, store.path, destination, { mustExist: true });
  if (!guarded.ok) {
    if (guarded.error.code === "not_found") {
      return installation;
    }
    throw fromFs(guarded.error);
  }

  const hash = await contentHash(fs, guarded.value.path);
  if (!hash.ok) {
    throw fromFs(hash.error);
  }

  if (hash.value !== installation.installedHash && !force) {
    throw new SkillManagerError({
      code: "drift_detected",
      message:
        `Isi ${guarded.value.path} sudah berubah sejak dipasang (hash berbeda). ` +
        "Tidak ada yang dihapus; setujui force untuk menghapus tetap.",
      details: {
        storeId: store.id,
        path: guarded.value.path,
        expectedHash: installation.installedHash,
        actualHash: hash.value,
      },
    });
  }

  const removed = await removeWithinStore(fs, store.path, guarded.value.path);
  if (!removed.ok) {
    throw fromFs(removed.error);
  }
  return installation;
}

function installationKey(installation: Installation): string {
  return `${installation.skillId}::${installation.storeId}`;
}

/** Hanya Installation yang benar-benar tercabut yang dihapus dari state. */
async function persistRemovals(
  fs: FileSystem,
  dataRoot: string,
  state: StateFile,
  removed: readonly Installation[],
): Promise<void> {
  if (removed.length === 0) {
    return;
  }
  const keys = new Set(removed.map(installationKey));
  const saved = await saveState(fs, dataRoot, {
    ...state,
    installations: state.installations.filter(
      (installation) => !keys.has(installationKey(installation)),
    ),
  });
  if (!saved.ok) {
    throw new SkillManagerError({
      code: "state_write_failed",
      message: `Salinan berhasil dihapus tetapi state.json gagal ditulis: ${saved.error.message}`,
      details: saved.error,
    });
  }
}

/**
 * Cabut satu skill dari beberapa Target sekaligus (spec §10.4, AC-7).
 *
 * Kegagalan satu Target tidak membatalkan Target lain (spec §14); hasil
 * dilaporkan per Target dalam urutan permintaan. Library tidak pernah disentuh
 * dan tidak ada akses jaringan, sehingga pemasangan ulang tidak perlu unduh.
 */
export async function uninstallSkill(options: UninstallOptions): Promise<readonly TargetResult[]> {
  const { fs, dataRoot } = options;
  const { skill, state } = await findSkill(fs, dataRoot, options.skill);
  const stores = new Map(
    listStores(options.adapters, { home: options.home, platform: options.platform }).map(
      (store) => [store.id, store],
    ),
  );

  const results: TargetResult[] = [];
  const removed: Installation[] = [];

  for (const targetId of options.targets) {
    try {
      const target = resolveTarget(options.adapters, targetId);
      const store = stores.get(target.storeId);
      if (store === undefined) {
        throw new SkillManagerError({
          code: "unknown_store",
          message: `Store "${target.storeId}" untuk Target "${targetId}" tidak dikenal.`,
        });
      }
      const installation = await uninstallOne(fs, state, skill, store, options.force === true);
      removed.push(installation);
      results.push({ targetId, ok: true, installation });
    } catch (error) {
      results.push({ targetId, ok: false, error: toTargetError(error) });
    }
  }

  await persistRemovals(fs, dataRoot, state, removed);
  return results;
}
