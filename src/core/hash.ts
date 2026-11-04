import { createHash } from "node:crypto";
import { type FileSystem, type FsResult, fsErr, fsOk, isExecutable } from "../fs/types.js";
import { walkTree } from "../fs/walk.js";

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
 *
 * Penelusuran memakai `walkTree` bersama agar semantik Windows (junction,
 * tautan menggantung) sama dengan pemindaian Store di ticket 08.
 */
export async function contentHash(fs: FileSystem, root: string): Promise<FsResult<string>> {
  const walked = await walkTree(fs, root);
  if (!walked.ok) {
    return walked;
  }

  const entries: HashEntry[] = [];
  for (const entry of walked.value) {
    if (entry.isSymlink) {
      const target = await fs.readlink(entry.path);
      if (!target.ok) {
        return fsErr(
          "unsafe_symlink",
          entry.path,
          "Tautan di dalam skill tidak bisa dibaca.",
          target.error,
        );
      }
      entries.push({ type: "symlink", path: entry.relativePath, target: target.value });
      continue;
    }

    if (entry.kind === "directory") {
      entries.push({ type: "directory", path: entry.relativePath });
      continue;
    }

    if (entry.kind !== "file") {
      return fsErr("io_error", entry.path, "Jenis entri tidak didukung contentHash.");
    }

    const stat = await fs.stat(entry.path);
    if (!stat.ok) {
      return stat;
    }
    const data = await fs.read(entry.path);
    if (!data.ok) {
      return data;
    }
    entries.push({
      type: "file",
      path: entry.relativePath,
      executable: isExecutable(stat.value),
      digest: sha256(data.value),
    });
  }

  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const document = JSON.stringify({ version: 1, entries });
  return fsOk(`${CONTENT_HASH_PREFIX}${sha256(document)}`);
}
