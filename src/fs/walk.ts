import path from "node:path";
import { type FileSystem, type FsResult, fsErr, fsOk } from "./types.js";

/** Satu entri hasil penelusuran, path relatif selalu memakai pemisah POSIX. */
export interface WalkEntry {
  /** Path absolut entri. */
  readonly path: string;
  /** Path relatif terhadap akar, dengan "/" sebagai pemisah. */
  readonly relativePath: string;
  readonly kind: "file" | "directory" | "symlink" | "other";
  /** Ukuran byte untuk file; 0 untuk entri lain. */
  readonly size: number;
  /** true bila entri adalah symlink/junction menurut `lstat`. */
  readonly isSymlink: boolean;
}

export interface WalkOptions {
  /** Batas jumlah entri; melewati batas = galat, bukan pemotongan diam-diam. */
  readonly maxEntries?: number;
  /** Batas total byte file; melewati batas = galat. */
  readonly maxBytes?: number;
}

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

/**
 * Telusuri pohon direktori secara deterministik (terurut berdasarkan nama).
 *
 * Aturan yang sama dengan `contentHash` dan pemindaian Store di ticket 08:
 * - klasifikasi memakai `readdir` yang sudah memakai `lstat` + `stat`,
 *   tidak pernah `dirent.isDirectory()` (junction Windows);
 * - tautan TIDAK diikuti; tautan menggantung dilaporkan sebagai entri
 *   `dangling` agar pemanggil bisa menolak atau melaporkannya;
 * - melewati `maxEntries`/`maxBytes` menghasilkan galat eksplisit.
 */
export async function walkTree(
  fs: FileSystem,
  root: string,
  options: WalkOptions = {},
): Promise<FsResult<WalkEntry[]>> {
  const rootStat = await fs.stat(root);
  if (!rootStat.ok) {
    return rootStat;
  }
  if (rootStat.value.kind !== "directory") {
    return fsErr("not_a_directory", root, "walkTree membutuhkan direktori.");
  }

  const entries: WalkEntry[] = [];
  const state = { count: 0, bytes: 0 };
  const walked = await visit(fs, root, root, "", options, entries, state);
  if (!walked.ok) {
    return walked;
  }
  return fsOk(entries);
}

interface WalkState {
  count: number;
  bytes: number;
}

async function visit(
  fs: FileSystem,
  rootPath: string,
  directory: string,
  relative: string,
  options: WalkOptions,
  entries: WalkEntry[],
  state: WalkState,
): Promise<FsResult<void>> {
  const listing = await fs.readdir(directory);
  if (!listing.ok) {
    return listing;
  }

  for (const entry of listing.value) {
    const entryPath = path.join(directory, entry.name);
    const relativePath = relative === "" ? entry.name : `${relative}/${entry.name}`;
    const canonical = toPosix(relativePath);

    state.count += 1;
    if (options.maxEntries !== undefined && state.count > options.maxEntries) {
      return fsErr("io_error", rootPath, `Jumlah entri melebihi batas ${options.maxEntries}.`);
    }

    const isSymlink = entry.isSymlink;
    const kind: WalkEntry["kind"] = entry.kind === "dangling" ? "symlink" : entry.kind;

    let size = 0;
    if (kind === "file") {
      const stat = await fs.stat(entryPath);
      if (!stat.ok) {
        return stat;
      }
      size = stat.value.size;
      state.bytes += size;
      if (options.maxBytes !== undefined && state.bytes > options.maxBytes) {
        return fsErr(
          "io_error",
          entryPath,
          `Ukuran total melebihi batas ${options.maxBytes} byte.`,
        );
      }
    }

    entries.push({ path: entryPath, relativePath: canonical, kind, size, isSymlink });

    if (entry.kind === "directory" && !isSymlink) {
      const nested = await visit(fs, rootPath, entryPath, relativePath, options, entries, state);
      if (!nested.ok) {
        return nested;
      }
    }
  }

  return fsOk(undefined);
}
