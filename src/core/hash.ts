import { createHash } from "node:crypto";
import path from "node:path";
import { type FileSystem, type FsResult, fsErr, fsOk, isExecutable } from "../fs/types.js";

/** Format hash kanonik: `sha256:<64 hex lowercase>`. */
export const CONTENT_HASH_PREFIX = "sha256:";

interface HashEntry {
  readonly type: "file" | "directory" | "symlink";
  /** Path relatif dari akar, selalu memakai pemisah POSIX. */
  readonly path: string;
  readonly executable?: boolean;
  readonly digest?: string;
  readonly target?: string;
}

function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

/**
 * Hash isi deterministik untuk sebuah direktori skill.
 *
 * Aturan (kontrak untuk ticket 04-08):
 * - Semua entri (file, direktori, symlink) diurutkan berdasarkan path relatif.
 * - File: `sha256` isi byte + bit executable.
 * - Direktori: termasuk direktori kosong.
 * - Symlink/junction: di-hash sebagai tautan (target mentah), TIDAK diikuti.
 * - mtime, uid/gid, dan mode selain bit executable tidak dipakai.
 * - Hasil: `sha256:<hex>` dari dokumen JSON kanonik.
 */
export async function contentHash(fs: FileSystem, root: string): Promise<FsResult<string>> {
  const rootStat = await fs.stat(root);
  if (!rootStat.ok) {
    return rootStat;
  }
  if (rootStat.value.kind !== "directory") {
    return fsErr("not_a_directory", root, "contentHash membutuhkan direktori skill.");
  }

  const entries: HashEntry[] = [];
  const walked = await walk(fs, root, "", entries);
  if (!walked.ok) {
    return walked;
  }

  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const document = JSON.stringify({ version: 1, entries });
  return fsOk(`${CONTENT_HASH_PREFIX}${sha256(document)}`);
}

async function walk(
  fs: FileSystem,
  directory: string,
  relative: string,
  entries: HashEntry[],
): Promise<FsResult<void>> {
  const listing = await fs.readdir(directory);
  if (!listing.ok) {
    return listing;
  }

  for (const entry of listing.value) {
    const entryPath = path.join(directory, entry.name);
    const relativePath = relative === "" ? entry.name : `${relative}/${entry.name}`;
    const canonicalPath = toPosix(relativePath);

    if (entry.isSymlink) {
      const target = await fs.readlink(entryPath);
      if (!target.ok) {
        return fsErr(
          "unsafe_symlink",
          entryPath,
          "Tautan di dalam skill tidak bisa dibaca.",
          target.error,
        );
      }
      entries.push({ type: "symlink", path: canonicalPath, target: target.value });
      continue;
    }

    if (entry.kind === "dangling") {
      return fsErr("unsafe_symlink", entryPath, "Tautan menggantung di dalam skill.");
    }

    if (entry.kind === "directory") {
      entries.push({ type: "directory", path: canonicalPath });
      const nested = await walk(fs, entryPath, relativePath, entries);
      if (!nested.ok) {
        return nested;
      }
      continue;
    }

    if (entry.kind !== "file") {
      return fsErr("io_error", entryPath, "Jenis entri tidak didukung contentHash.");
    }

    const stat = await fs.stat(entryPath);
    if (!stat.ok) {
      return stat;
    }
    const data = await fs.read(entryPath);
    if (!data.ok) {
      return data;
    }
    entries.push({
      type: "file",
      path: canonicalPath,
      executable: isExecutable(stat.value),
      digest: sha256(data.value),
    });
  }

  return fsOk(undefined);
}
