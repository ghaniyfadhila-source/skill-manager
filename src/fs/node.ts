import * as fsp from "node:fs/promises";
import path from "node:path";
import { isPathInside } from "./guard.js";
import {
  type DirEntry,
  type FileKind,
  type FileStat,
  type FileSystem,
  type FsError,
  type FsErrorCode,
  type FsResult,
  fsErr,
  fsOk,
  type MkdirOptions,
  type RemoveOptions,
  type SymlinkOptions,
  type WriteOptions,
} from "./types.js";

const ERROR_CODES: Record<string, FsErrorCode> = {
  EACCES: "permission_denied",
  EPERM: "permission_denied",
  EEXIST: "already_exists",
  EISDIR: "is_a_directory",
  ELOOP: "symlink_loop",
  ENAMETOOLONG: "invalid_path",
  ENOENT: "not_found",
  ENOTDIR: "not_a_directory",
  ENOTEMPTY: "not_empty",
  EINVAL: "invalid_path",
  EXDEV: "io_error",
};

function nodeErrno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toFsError(error: unknown, targetPath: string, message?: string): FsError {
  const code = ERROR_CODES[nodeErrno(error) ?? ""] ?? "io_error";
  return {
    code,
    path: targetPath,
    message: message ?? `Operasi filesystem gagal: ${describe(error)}`,
    cause: error,
  };
}

function kindOf(stats: {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}): FileKind {
  if (stats.isSymbolicLink()) {
    return "symlink";
  }
  if (stats.isDirectory()) {
    return "directory";
  }
  if (stats.isFile()) {
    return "file";
  }
  return "other";
}

function statOf(stats: {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  size: number;
  mode: number;
  mtimeMs: number;
}): FileStat {
  return {
    kind: kindOf(stats),
    size: stats.size,
    mode: stats.mode,
    mtimeMs: stats.mtimeMs,
  };
}

function entryKindOf(stats: {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}): DirEntry["kind"] {
  const kind = kindOf(stats);
  return kind === "file" || kind === "directory" ? kind : "other";
}

/**
 * Implementasi FileSystem di atas node:fs.
 *
 * Dua jebakan platform yang sengaja ditangani:
 * 1. junction Windows dilaporkan `dirent.isDirectory() === false` walau
 *    `lstat` melihatnya sebagai symlink dan `stat` melihatnya sebagai
 *    direktori. Karena itu klasifikasi entri selalu memakai `lstat` + `stat`,
 *    tidak pernah `dirent.isDirectory()`.
 * 2. Tautan menggantung: `lstat` berhasil, `stat`/realpath ENOENT, sedangkan
 *    `access` bisa saja berhasil. `exists` memakai `lstat`, bukan `access`.
 */
export class NodeFileSystem implements FileSystem {
  async read(targetPath: string): Promise<FsResult<Uint8Array>> {
    try {
      const data = await fsp.readFile(targetPath);
      return fsOk(new Uint8Array(data));
    } catch (error) {
      return { ok: false, error: toFsError(error, targetPath) };
    }
  }

  async readText(targetPath: string): Promise<FsResult<string>> {
    const bytes = await this.read(targetPath);
    if (!bytes.ok) {
      return bytes;
    }
    try {
      return fsOk(new TextDecoder("utf-8", { fatal: true }).decode(bytes.value));
    } catch (error) {
      return fsErr("invalid_utf8", targetPath, "Isi file bukan UTF-8 yang valid.", error);
    }
  }

  async write(
    targetPath: string,
    data: Uint8Array | string,
    options?: WriteOptions,
  ): Promise<FsResult<void>> {
    try {
      await fsp.writeFile(targetPath, data, { mode: options?.mode ?? 0o644 });
      return fsOk(undefined);
    } catch (error) {
      return { ok: false, error: toFsError(error, targetPath) };
    }
  }

  async copy(source: string, destination: string): Promise<FsResult<void>> {
    const sourceAbsolute = path.resolve(source);
    const destinationAbsolute = path.resolve(destination);

    const sourceReal = await this.realpath(sourceAbsolute);
    if (!sourceReal.ok) {
      return sourceReal;
    }
    const destinationParent = await this.realpath(path.dirname(destinationAbsolute));
    if (!destinationParent.ok) {
      return destinationParent;
    }
    const destinationKey = path.join(destinationParent.value, path.basename(destinationAbsolute));
    if (isPathInside(sourceReal.value, destinationParent.value)) {
      return fsErr("invalid_path", destination, "Tidak bisa menyalin direktori ke dalam dirinya.");
    }
    if (await this.exists(destinationKey)) {
      return fsErr("already_exists", destination, "Tujuan copy sudah ada.");
    }

    return this.copyEntry(sourceReal.value, destinationKey, sourceReal.value, new Set());
  }

  async remove(targetPath: string, options?: RemoveOptions): Promise<FsResult<void>> {
    return this.removeAt(path.resolve(targetPath), options?.recursive === true);
  }

  async realpath(targetPath: string): Promise<FsResult<string>> {
    try {
      return fsOk(await fsp.realpath(targetPath));
    } catch (error) {
      return { ok: false, error: toFsError(error, targetPath) };
    }
  }

  async stat(targetPath: string): Promise<FsResult<FileStat>> {
    try {
      return fsOk(statOf(await fsp.stat(targetPath)));
    } catch (error) {
      return { ok: false, error: toFsError(error, targetPath) };
    }
  }

  async lstat(targetPath: string): Promise<FsResult<FileStat>> {
    try {
      return fsOk(statOf(await fsp.lstat(targetPath)));
    } catch (error) {
      return { ok: false, error: toFsError(error, targetPath) };
    }
  }

  async readdir(targetPath: string): Promise<FsResult<DirEntry[]>> {
    try {
      const names = await fsp.readdir(targetPath);
      const entries: DirEntry[] = [];
      for (const name of names) {
        const entryPath = path.join(targetPath, name);
        const entryStat = await fsp.lstat(entryPath);
        const isSymlink = entryStat.isSymbolicLink();
        if (!isSymlink) {
          entries.push({ name, kind: entryKindOf(entryStat), isSymlink });
          continue;
        }
        try {
          const resolved = await fsp.stat(entryPath);
          entries.push({ name, kind: entryKindOf(resolved), isSymlink });
        } catch (error) {
          const code = nodeErrno(error);
          if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") {
            entries.push({ name, kind: "dangling", isSymlink });
            continue;
          }
          throw error;
        }
      }
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return fsOk(entries);
    } catch (error) {
      return { ok: false, error: toFsError(error, targetPath) };
    }
  }

  async mkdir(targetPath: string, options?: MkdirOptions): Promise<FsResult<void>> {
    try {
      await fsp.mkdir(targetPath, { recursive: options?.recursive ?? true });
      return fsOk(undefined);
    } catch (error) {
      return { ok: false, error: toFsError(error, targetPath) };
    }
  }

  async rename(from: string, to: string): Promise<FsResult<void>> {
    try {
      await fsp.rename(from, to);
      return fsOk(undefined);
    } catch (error) {
      return { ok: false, error: toFsError(error, to) };
    }
  }

  async exists(targetPath: string): Promise<boolean> {
    try {
      await fsp.lstat(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  async readlink(targetPath: string): Promise<FsResult<string>> {
    try {
      return fsOk(await fsp.readlink(targetPath));
    } catch (error) {
      return { ok: false, error: toFsError(error, targetPath) };
    }
  }

  async symlink(
    target: string,
    linkPath: string,
    options?: SymlinkOptions,
  ): Promise<FsResult<void>> {
    try {
      let type = options?.type;
      if (type === undefined && process.platform === "win32") {
        try {
          const stats = await fsp.stat(target);
          type = stats.isDirectory() ? "junction" : "file";
        } catch {
          type = "file";
        }
      }
      await fsp.symlink(target, linkPath, type);
      return fsOk(undefined);
    } catch (error) {
      return { ok: false, error: toFsError(error, linkPath) };
    }
  }

  private async copyEntry(
    source: string,
    destination: string,
    sourceRoot: string,
    activeDirectories: Set<string>,
  ): Promise<FsResult<void>> {
    let sourceStat: Awaited<ReturnType<typeof fsp.lstat>>;
    try {
      sourceStat = await fsp.lstat(source);
    } catch (error) {
      return { ok: false, error: toFsError(error, source) };
    }

    if (sourceStat.isSymbolicLink()) {
      const resolved = await this.realpath(source);
      if (!resolved.ok) {
        return fsErr(
          "unsafe_symlink",
          source,
          "Tautan di dalam sumber tidak bisa disalin karena targetnya tidak ada.",
          resolved.error,
        );
      }
      if (!isPathInside(sourceRoot, resolved.value)) {
        return fsErr(
          "unsafe_symlink",
          source,
          "Tautan di dalam sumber menunjuk keluar dari folder sumber.",
        );
      }
      return this.copyEntry(resolved.value, destination, sourceRoot, activeDirectories);
    }

    if (sourceStat.isFile()) {
      try {
        await fsp.copyFile(source, destination);
        await fsp.chmod(destination, sourceStat.mode & 0o777);
        return fsOk(undefined);
      } catch (error) {
        return { ok: false, error: toFsError(error, destination) };
      }
    }

    if (!sourceStat.isDirectory()) {
      return fsErr("io_error", source, "Jenis entri tidak didukung untuk copy.");
    }

    const canonical = await this.realpath(source);
    if (!canonical.ok) {
      return canonical;
    }
    if (activeDirectories.has(canonical.value)) {
      return fsErr("symlink_loop", source, "Siklus direktori saat copy.");
    }

    try {
      await fsp.mkdir(destination);
      activeDirectories.add(canonical.value);
      const entries = await fsp.readdir(canonical.value);
      for (const name of entries) {
        const copied = await this.copyEntry(
          path.join(canonical.value, name),
          path.join(destination, name),
          sourceRoot,
          activeDirectories,
        );
        if (!copied.ok) {
          activeDirectories.delete(canonical.value);
          return copied;
        }
      }
      activeDirectories.delete(canonical.value);
      return fsOk(undefined);
    } catch (error) {
      return { ok: false, error: toFsError(error, destination) };
    }
  }

  private async removeAt(targetPath: string, recursive: boolean): Promise<FsResult<void>> {
    let stats: Awaited<ReturnType<typeof fsp.lstat>>;
    try {
      stats = await fsp.lstat(targetPath);
    } catch (error) {
      return { ok: false, error: toFsError(error, targetPath) };
    }

    // Tautan (termasuk junction) selalu di-unlink, tidak pernah ditelusuri.
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      try {
        await fsp.unlink(targetPath);
        return fsOk(undefined);
      } catch (error) {
        return { ok: false, error: toFsError(error, targetPath) };
      }
    }

    if (!recursive) {
      try {
        await fsp.rmdir(targetPath);
        return fsOk(undefined);
      } catch (error) {
        return { ok: false, error: toFsError(error, targetPath) };
      }
    }

    try {
      const entries = await fsp.readdir(targetPath);
      for (const name of entries) {
        const childPath = path.join(targetPath, name);
        const childStats = await fsp.lstat(childPath);
        if (childStats.isSymbolicLink()) {
          await fsp.unlink(childPath);
          continue;
        }
        const removed = await this.removeAt(childPath, true);
        if (!removed.ok) {
          return removed;
        }
      }
      await fsp.rmdir(targetPath);
      return fsOk(undefined);
    } catch (error) {
      return { ok: false, error: toFsError(error, targetPath) };
    }
  }
}
