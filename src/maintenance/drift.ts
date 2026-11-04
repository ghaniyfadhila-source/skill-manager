import path from "node:path";
import { listStores } from "../adapters/index.js";
import type { Adapter } from "../adapters/manifest.js";
import { contentHash } from "../core/hash.js";
import { loadState } from "../core/state.js";
import type { DriftStatus, Skill, Store } from "../core/types.js";
import { TEMP_PREFIX } from "../fs/atomic.js";
import type { FileSystem, FsError } from "../fs/types.js";

/** Galat yang membuat satu entri tidak bisa diverifikasi (laporan tetap jalan). */
export interface DriftEntryError {
  readonly code: string;
  readonly message: string;
}

/**
 * Satu baris laporan drift (spec §10.5). Entri `unmanaged` tidak punya
 * Installation; `skillName`-nya berisi nama folder asing di Store.
 */
export interface DriftEntry {
  readonly status: DriftStatus;
  readonly storeId: string;
  /** Path absolut direktori skill di Store (atau folder asing untuk unmanaged). */
  readonly path: string;
  readonly skillId?: string;
  readonly skillName?: string;
  readonly installedHash?: string;
  /** Hash isi Store saat ini; tidak ada untuk `missing`/verifikasi gagal. */
  readonly storeHash?: string;
  /** true bila hash Store berbeda dari hash Library saat ini (tertinggal). */
  readonly behindLibrary?: boolean;
  /** Terisi bila isi direktori tidak bisa dibaca; entri tetap dilaporkan. */
  readonly error?: DriftEntryError;
}

export interface DriftReport {
  readonly entries: readonly DriftEntry[];
  /** Jumlah Target yang hash Store-nya berbeda dari hash Library saat ini. */
  readonly staleCount: number;
}

export interface DriftOptions {
  readonly adapters: readonly Adapter[];
  /** Nama atau id skill; bila diisi, hanya Installation skill itu yang dilaporkan. */
  readonly skill?: string;
  readonly home?: string;
  readonly platform?: NodeJS.Platform;
}

function toEntryError(error: FsError): DriftEntryError {
  return { code: error.code, message: error.message };
}

function isWantedSkill(skill: Skill, filter: string | undefined): boolean {
  return filter === undefined || skill.name === filter || skill.id === filter;
}

/**
 * Hitung status drift setiap Installation terhadap Library (spec §10.5).
 *
 * - `clean`/`modified` dari perbandingan hash Store dengan `installedHash`.
 * - `missing` bila direktori sudah tidak ada.
 * - `unmanaged` untuk direktori Store yang tidak tercatat di state; dihitung
 *   per Store lewat `listStores`. Bila `skill` difilter, bagian ini dilewati
 *   karena tidak ada Installation yang bisa diatribusikan.
 * - Satu direktori rusak tidak menggagalkan laporan: entri tetap dikembalikan
 *   dengan `error` dan status `modified` (tidak terbukti bersih).
 */
export async function computeDrift(
  fs: FileSystem,
  dataRoot: string,
  options: DriftOptions,
): Promise<DriftReport> {
  const { state } = await loadState(fs, dataRoot);
  const stores = listStores(options.adapters, {
    home: options.home,
    platform: options.platform,
  });
  const storesById = new Map(stores.map((store) => [store.id, store]));
  const skills = new Map(state.library.map((skill) => [skill.id, skill]));
  const filter = options.skill;

  const entries: DriftEntry[] = [];
  let staleCount = 0;

  for (const installation of state.installations) {
    const skill = skills.get(installation.skillId);
    if (filter !== undefined && (skill === undefined || !isWantedSkill(skill, filter))) {
      continue;
    }
    const store = storesById.get(installation.storeId);
    const skillName = skill?.name;

    if (skill === undefined || store === undefined) {
      entries.push({
        status: "missing",
        storeId: installation.storeId,
        path: "",
        skillId: installation.skillId,
        skillName,
        installedHash: installation.installedHash,
        error:
          skill === undefined
            ? { code: "skill_not_found", message: "Entri Library untuk Installation ini hilang." }
            : { code: "unknown_store", message: "Store Installation ini tidak dikenal adapter." },
      });
      continue;
    }

    const destination = path.join(store.path, skill.dirName);
    const stat = await fs.stat(destination);
    if (!stat.ok) {
      const notFound = stat.error.code === "not_found";
      entries.push({
        status: notFound ? "missing" : "modified",
        storeId: store.id,
        path: destination,
        skillId: skill.id,
        skillName,
        installedHash: installation.installedHash,
        ...(notFound ? {} : { error: toEntryError(stat.error) }),
      });
      continue;
    }
    if (stat.value.kind !== "directory") {
      entries.push({
        status: "modified",
        storeId: store.id,
        path: destination,
        skillId: skill.id,
        skillName,
        installedHash: installation.installedHash,
        error: { code: "not_a_directory", message: "Path skill di Store bukan direktori." },
      });
      continue;
    }

    const hash = await contentHash(fs, destination);
    if (!hash.ok) {
      entries.push({
        status: "modified",
        storeId: store.id,
        path: destination,
        skillId: skill.id,
        skillName,
        installedHash: installation.installedHash,
        error: toEntryError(hash.error),
      });
      continue;
    }

    const behindLibrary = hash.value !== skill.contentHash;
    if (behindLibrary) {
      staleCount += 1;
    }
    entries.push({
      status: hash.value === installation.installedHash ? "clean" : "modified",
      storeId: store.id,
      path: destination,
      skillId: skill.id,
      skillName,
      installedHash: installation.installedHash,
      storeHash: hash.value,
      behindLibrary,
    });
  }

  if (filter === undefined) {
    entries.push(...(await unmanagedEntries(fs, state.installations, skills, stores)));
  }

  return { entries, staleCount };
}

/** Direktori Store yang tidak tercatat sebagai Installation (per Store). */
async function unmanagedEntries(
  fs: FileSystem,
  installations: readonly { readonly skillId: string; readonly storeId: string }[],
  skills: ReadonlyMap<string, Skill>,
  stores: readonly Store[],
): Promise<DriftEntry[]> {
  const recorded = new Map<string, Set<string>>();
  for (const installation of installations) {
    const skill = skills.get(installation.skillId);
    if (skill === undefined) {
      continue;
    }
    const names = recorded.get(installation.storeId) ?? new Set<string>();
    names.add(skill.dirName);
    recorded.set(installation.storeId, names);
  }

  const entries: DriftEntry[] = [];
  for (const store of stores) {
    const listing = await fs.readdir(store.path);
    if (!listing.ok) {
      continue;
    }
    const known = recorded.get(store.id) ?? new Set<string>();
    for (const entry of listing.value) {
      // `kind` sudah dihitung dengan lstat+stat oleh FileSystem, jadi junction
      // Windows yang menunjuk direktori tetap terhitung direktori.
      if (entry.kind !== "directory" || known.has(entry.name)) {
        continue;
      }
      if (entry.name.startsWith(TEMP_PREFIX)) {
        continue;
      }
      entries.push({
        status: "unmanaged",
        storeId: store.id,
        path: path.join(store.path, entry.name),
        skillName: entry.name,
      });
    }
  }
  return entries;
}
