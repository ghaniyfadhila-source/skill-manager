import path from "node:path";
import { type FileSystem, type FsResult, fsErr, fsOk } from "./types.js";

export interface GuardedPath {
  /** Path absolut yang diminta, sudah dinormalisasi; tautan final TIDAK diikuti. */
  readonly path: string;
  /** Path kanonik hasil realpath, atau calon path kanonik bila belum ada. */
  readonly realPath: string;
  /** true bila entri final adalah tautan (symlink/junction). */
  readonly symlink: boolean;
}

export interface GuardStorePathOptions {
  /** true untuk operasi baca/hapus; false untuk operasi tulis path baru. */
  readonly mustExist?: boolean;
}

/**
 * Perbandingan containment yang sadar platform. `path.relative` menangani
 * case-insensitive Windows dan perbedaan drive.
 */
export function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

/** Perbandingan path yang sadar case (Windows case-insensitive, POSIX tidak). */
function isSamePath(left: string, right: string): boolean {
  return path.relative(path.resolve(left), path.resolve(right)) === "";
}

/**
 * Guard realpath untuk operasi Store (spec §13):
 * - storeRoot dan target wajib absolut;
 * - target harus berada di dalam storeRoot secara leksikal;
 * - target canonical (realpath) juga harus berada di dalam store canonical;
 * - tautan menggantung ditolak, karena `lstat` berhasil tetapi targetnya tidak
 *   bisa diverifikasi.
 *
 * Path yang belum ada (operasi tulis) diverifikasi lewat leluhur terdekat yang
 * ada; sisa segmen ditambahkan secara leksikal.
 */
export async function guardStorePath(
  fs: FileSystem,
  storeRoot: string,
  targetPath: string,
  options: GuardStorePathOptions = {},
): Promise<FsResult<GuardedPath>> {
  if (!path.isAbsolute(storeRoot) || !path.isAbsolute(targetPath)) {
    return fsErr("invalid_path", targetPath, "Path Store dan target harus absolut.");
  }

  const storeLexical = path.resolve(storeRoot);
  const targetLexical = path.resolve(targetPath);
  if (!isPathInside(storeLexical, targetLexical)) {
    return fsErr("unsafe_path", targetPath, "Target berada di luar Store yang diharapkan.");
  }

  const storeReal = await fs.realpath(storeLexical);
  if (!storeReal.ok) {
    return storeReal;
  }

  const targetLstat = await fs.lstat(targetLexical);
  if (targetLstat.ok) {
    const targetReal = await fs.realpath(targetLexical);
    if (!targetReal.ok) {
      if (targetReal.error.code === "not_found") {
        return fsErr(
          "unsafe_symlink",
          targetPath,
          "Target adalah tautan menggantung; operasi ditolak.",
          targetReal.error,
        );
      }
      return targetReal;
    }
    if (!isPathInside(storeReal.value, targetReal.value)) {
      return fsErr("unsafe_path", targetPath, "Target menunjuk keluar dari Store melalui tautan.");
    }
    return fsOk({
      path: targetLexical,
      realPath: targetReal.value,
      symlink: targetLstat.value.kind === "symlink",
    });
  }

  if (targetLstat.error.code !== "not_found") {
    return targetLstat;
  }
  if (options.mustExist === true) {
    return targetLstat;
  }

  const missing: string[] = [];
  let ancestor = targetLexical;
  while (true) {
    const ancestorLstat = await fs.lstat(ancestor);
    if (ancestorLstat.ok) {
      break;
    }
    if (ancestorLstat.error.code !== "not_found") {
      return ancestorLstat;
    }
    const parent = path.dirname(ancestor);
    if (parent === ancestor) {
      return fsErr("not_found", targetPath, "Tidak ada leluhur yang bisa diverifikasi.");
    }
    missing.unshift(path.basename(ancestor));
    ancestor = parent;
  }

  const ancestorReal = await fs.realpath(ancestor);
  if (!ancestorReal.ok) {
    return fsErr(
      "unsafe_symlink",
      targetPath,
      "Leluhur target adalah tautan menggantung; operasi ditolak.",
      ancestorReal.error,
    );
  }
  if (!isPathInside(storeReal.value, ancestorReal.value)) {
    return fsErr(
      "unsafe_path",
      targetPath,
      "Leluhur target menunjuk keluar dari Store melalui tautan.",
    );
  }

  return fsOk({
    path: targetLexical,
    realPath: path.join(ancestorReal.value, ...missing),
    symlink: false,
  });
}

/**
 * Hapus satu entri di dalam Store. Guard memastikan target tidak keluar Store;
 * `FileSystem.remove` sendiri memeriksa tautan per entri dan tidak pernah
 * menghapus target tautan.
 */
export async function removeWithinStore(
  fs: FileSystem,
  storeRoot: string,
  targetPath: string,
): Promise<FsResult<void>> {
  if (!path.isAbsolute(storeRoot) || !path.isAbsolute(targetPath)) {
    return fsErr("invalid_path", targetPath, "Path Store dan target harus absolut.");
  }
  if (isSamePath(storeRoot, targetPath)) {
    return fsErr("invalid_path", targetPath, "Store itu sendiri tidak boleh dihapus.");
  }
  const guarded = await guardStorePath(fs, storeRoot, targetPath, { mustExist: true });
  if (!guarded.ok) {
    return guarded;
  }
  return fs.remove(guarded.value.path, { recursive: true });
}
