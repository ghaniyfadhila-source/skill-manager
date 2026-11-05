import path from "node:path";
import { listStores, resolveTarget } from "../adapters/index.js";
import type { Adapter } from "../adapters/manifest.js";
import { SkillManagerError } from "../core/errors.js";
import { contentHash } from "../core/hash.js";
import { resolveLibrarySkill } from "../core/skill-lookup.js";
import { saveState } from "../core/state.js";
import type {
  Installation,
  Skill,
  StateFile,
  Store,
  Target,
  TargetError,
  TargetResult,
} from "../core/types.js";
import { type PopulateTempDirectory, writeDirectoryAtomic } from "../fs/atomic.js";
import { guardStorePath, removeWithinStore } from "../fs/guard.js";
import { type FileSystem, type FsError, fsOk } from "../fs/types.js";

export interface InstallOptions {
  readonly fs: FileSystem;
  readonly dataRoot: string;
  readonly adapters: readonly Adapter[];
  /** Nama skill di Library (atau id-nya). */
  readonly skill: string;
  /** Id Target, mis. `"opencode/global"`; urutan hasil mengikuti urutan ini. */
  readonly targets: readonly string[];
  /**
   * Persetujuan user untuk menulis ke grup shared setelah melihat daftar
   * member terdampak (AC-6). Tanpa ini, Target shared ditolak sebelum ada
   * penulisan apa pun.
   */
  readonly acknowledgeShared?: boolean;
  /** Pilih grup shared untuk semua Target (spec §5.1, flag `--shared`). */
  readonly shared?: boolean;
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

/** Isi direktori sementara dengan salinan isi skill Library. */
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
    return fsOk(undefined);
  };
}

interface InstallContext {
  readonly fs: FileSystem;
  readonly state: StateFile;
  readonly skill: Skill;
  readonly source: string;
}

interface ConflictOwner {
  readonly skillId: string;
  readonly name: string;
}

/** Skill yang tercatat memiliki direktori tujuan di Store ini, bila ada. */
function findOwner(state: StateFile, storeId: string, dirName: string): ConflictOwner | undefined {
  for (const installation of state.installations) {
    if (installation.storeId !== storeId) {
      continue;
    }
    const owner = state.library.find(
      (entry) => entry.id === installation.skillId && entry.dirName === dirName,
    );
    if (owner !== undefined) {
      return { skillId: owner.id, name: owner.name };
    }
  }
  return undefined;
}

function conflictError(
  destination: string,
  storeId: string,
  owner: ConflictOwner | undefined,
): SkillManagerError {
  const owned =
    owner === undefined ? "tidak tercatat sebagai Installation" : `milik skill "${owner.name}"`;
  return new SkillManagerError({
    code: "install_conflict",
    message: `${destination} sudah ada di Store ${storeId} (${owned}). Tidak ada yang ditimpa.`,
    details: { path: destination, storeId, owner: owner ?? null },
  });
}

async function installOne(
  context: InstallContext,
  store: Store,
  installedAt: string,
): Promise<Installation> {
  const destination = path.join(store.path, context.skill.dirName);
  await ensureStoreDirectory(context.fs, store.path);

  const guarded = await guardStorePath(context.fs, store.path, destination);
  if (!guarded.ok) {
    throw fromFs(guarded.error);
  }

  // Konflik (spec §10.3 poin 3): tujuan yang sudah ada tidak pernah ditimpa,
  // dan pemiliknya disebut agar user tahu apa yang sedang menempatinya.
  if (await context.fs.exists(guarded.value.path)) {
    throw conflictError(
      guarded.value.path,
      store.id,
      findOwner(context.state, store.id, context.skill.dirName),
    );
  }

  const written = await writeDirectoryAtomic(
    context.fs,
    guarded.value.path,
    populateFrom(context.fs, context.source),
  );
  if (!written.ok) {
    if (written.error.code === "already_exists") {
      throw conflictError(
        guarded.value.path,
        store.id,
        findOwner(context.state, store.id, context.skill.dirName),
      );
    }
    throw fromFs(written.error);
  }

  // Hash dihitung di TUJUAN setelah salin (spec §10.3 poin 4); bila gagal,
  // salinan dibatalkan agar tidak ada direktori tanpa Installation.
  const hash = await contentHash(context.fs, guarded.value.path);
  if (!hash.ok) {
    await removeWithinStore(context.fs, store.path, guarded.value.path);
    throw fromFs(hash.error);
  }

  return {
    skillId: context.skill.id,
    storeId: store.id,
    mode: "copy",
    installedHash: hash.value,
    installedAt,
  };
}

type PlanEntry =
  | { readonly targetId: string; readonly store: Store; readonly error?: undefined }
  | { readonly targetId: string; readonly store?: undefined; readonly error: TargetError };

function resolvePlanEntry(
  options: InstallOptions,
  targetId: string,
  stores: ReadonlyMap<string, Store>,
): PlanEntry {
  try {
    const target: Target = resolveTarget(options.adapters, targetId, {
      shared: options.shared,
    });
    const store = stores.get(target.storeId);
    if (store === undefined) {
      throw new SkillManagerError({
        code: "unknown_store",
        message: `Store "${target.storeId}" untuk Target "${targetId}" tidak dikenal.`,
      });
    }
    return { targetId, store };
  } catch (error) {
    return { targetId, error: toTargetError(error) };
  }
}

/**
 * Konfirmasi grup shared (spec §5.1, AC-6): sebelum ada penulisan, user wajib
 * melihat member yang terdampak. Galat menyebut daftarnya agar UI/CLI bisa
 * menampilkan peringatan yang sama.
 */
function assertSharedAcknowledged(
  plan: readonly PlanEntry[],
  acknowledgeShared: boolean | undefined,
): void {
  if (acknowledgeShared === true) {
    return;
  }
  const shared = plan.filter((entry) => entry.store !== undefined && !entry.store.exclusive);
  if (shared.length === 0) {
    return;
  }
  const storeList = new Map<string, Store>();
  for (const entry of shared) {
    if (entry.store !== undefined) {
      storeList.set(entry.store.id, entry.store);
    }
  }
  const stores = [...storeList.values()];
  const described = stores.map((store) => `${store.id} (member: ${store.members.join(", ")})`);
  const targets = shared.map((entry) => entry.targetId);
  throw new SkillManagerError({
    code: "shared_confirmation_required",
    message:
      `Memasang ke grup shared akan terlihat oleh semua member terdampak: ${described.join("; ")}. ` +
      "Setujui dulu dengan acknowledgeShared.",
    details: {
      stores: stores.map((store) => ({ storeId: store.id, members: [...store.members] })),
      targets,
    },
  });
}

function installationKey(installation: Installation): string {
  return `${installation.skillId}::${installation.storeId}`;
}

async function persistInstallations(
  fs: FileSystem,
  dataRoot: string,
  state: StateFile,
  installations: readonly Installation[],
): Promise<void> {
  if (installations.length === 0) {
    return;
  }
  const replaced = new Set(installations.map(installationKey));
  const kept = state.installations.filter(
    (installation) => !replaced.has(installationKey(installation)),
  );
  const saved = await saveState(fs, dataRoot, {
    ...state,
    installations: [...kept, ...installations],
  });
  if (!saved.ok) {
    throw new SkillManagerError({
      code: "state_write_failed",
      message: `Installation berhasil disalin tetapi state.json gagal ditulis: ${saved.error.message}`,
      details: saved.error,
    });
  }
}

/**
 * Pasang satu skill ke beberapa Target sekaligus (spec §10.3).
 *
 * - Target -> Store lewat `resolveTarget`; store shared harus disetujui dulu
 *   (`acknowledgeShared`) dan galatnya menyebut member terdampak (AC-6).
 * - Kegagalan satu Target tidak membatalkan Target lain (spec §14).
 * - Tujuan yang sudah ada tidak pernah ditimpa.
 * - Selalu `mode: "copy"`; symlink belum ada di v0.1 (ADR-0001).
 */
export async function installSkill(options: InstallOptions): Promise<readonly TargetResult[]> {
  const { fs, dataRoot } = options;
  const { skill, source, state } = await resolveLibrarySkill(fs, dataRoot, options.skill);
  const stores = new Map(
    listStores(options.adapters, { home: options.home, platform: options.platform }).map(
      (store) => [store.id, store],
    ),
  );

  const plan = options.targets.map((targetId) => resolvePlanEntry(options, targetId, stores));
  assertSharedAcknowledged(plan, options.acknowledgeShared);

  const context: InstallContext = { fs, state, skill, source };
  const results: TargetResult[] = [];
  const installations: Installation[] = [];

  for (const entry of plan) {
    if (entry.error !== undefined) {
      results.push({ targetId: entry.targetId, ok: false, error: entry.error });
      continue;
    }
    try {
      const installation = await installOne(context, entry.store, new Date().toISOString());
      installations.push(installation);
      results.push({ targetId: entry.targetId, ok: true, installation });
    } catch (error) {
      results.push({ targetId: entry.targetId, ok: false, error: toTargetError(error) });
    }
  }

  await persistInstallations(fs, dataRoot, state, installations);
  return results;
}
