/**
 * Seam tunggal untuk seluruh I/O domain.
 *
 * `core` tidak pernah mengimpor `node:fs`; semua operasi file lewat antarmuka
 * ini. Setiap kegagalan dikembalikan sebagai `FsResult` dengan kode stabil —
 * jangan pernah membocorkan `ENOENT` mentah ke domain.
 */

/** Kode galat filesystem yang stabil untuk domain, CLI, dan HTTP. */
export type FsErrorCode =
  | "not_found"
  | "permission_denied"
  | "already_exists"
  | "not_a_directory"
  | "is_a_directory"
  | "not_empty"
  | "invalid_path"
  | "invalid_utf8"
  | "unsafe_path"
  | "unsafe_symlink"
  | "symlink_loop"
  | "process_not_found"
  | "process_failed"
  | "io_error";

export interface FsError {
  readonly code: FsErrorCode;
  /** Path yang terlibat saat galat terjadi (absolut bila masukan absolut). */
  readonly path: string;
  /** Pesan manusiawi dalam bahasa Indonesia. */
  readonly message: string;
  /** Penyebab asli (mis. `NodeJS.ErrnoException`), hanya untuk diagnostik. */
  readonly cause?: unknown;
}

export type FsResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: FsError };

export function fsOk<T>(value: T): FsResult<T> {
  return { ok: true, value };
}

export function fsError(
  code: FsErrorCode,
  path: string,
  message: string,
  cause?: unknown,
): FsError {
  if (cause === undefined) {
    return { code, path, message };
  }
  return { code, path, message, cause };
}

export function fsErr<T = never>(
  code: FsErrorCode,
  path: string,
  message: string,
  cause?: unknown,
): FsResult<T> {
  return { ok: false, error: fsError(code, path, message, cause) };
}

/**
 * Jenis entri menurut `stat` (mengikuti tautan). `symlink` hanya muncul dari
 * `lstat`; `readdir` memakai `dangling` untuk tautan yang targetnya hilang.
 */
export type FileKind = "file" | "directory" | "symlink" | "other";

export interface FileStat {
  readonly kind: FileKind;
  readonly size: number;
  /** Bit mode POSIX; di Windows hanya bit write yang bermakna. */
  readonly mode: number;
  readonly mtimeMs: number;
}

/** Bit executable: satu-satunya bagian mode yang memengaruhi contentHash. */
export function isExecutable(stat: Pick<FileStat, "mode">): boolean {
  return (stat.mode & 0o111) !== 0;
}

export interface DirEntry {
  readonly name: string;
  /**
   * Jenis entri setelah mengikuti tautan. `dangling` berarti tautan menggantung:
   * `lstat` berhasil, `stat` ENOENT.
   */
  readonly kind: "file" | "directory" | "other" | "dangling";
  /**
   * true bila entri adalah symlink/junction menurut `lstat`. Jangan pernah
   * memakai `kind === "directory"` untuk memutuskan penghapusan rekursif;
   * periksa `isSymlink` lebih dulu.
   */
  readonly isSymlink: boolean;
}

export interface WriteOptions {
  /** Default 0o644. Bit executable dipertahankan bila diberikan. */
  readonly mode?: number;
}

export interface MkdirOptions {
  /** Default true. */
  readonly recursive?: boolean;
}

export interface RemoveOptions {
  /** Default false. Bila true, isi direktori dihapus tanpa mengikuti tautan. */
  readonly recursive?: boolean;
}

export interface SymlinkOptions {
  /** Nama tipe mengikuti `node:fs`; di Windows direktori memakai `junction`. */
  readonly type?: "file" | "dir" | "junction";
}

/**
 * Semua path boleh absolut; operasi tulis/hapus di domain wajib melewati
 * guard realpath (`src/fs/guard.ts`) agar tidak keluar dari Store.
 */
export interface FileSystem {
  /** Baca isi file sebagai byte. Mengikuti tautan. */
  read(path: string): Promise<FsResult<Uint8Array>>;
  /** Baca file UTF-8; galat `invalid_utf8` untuk byte yang bukan UTF-8. */
  readText(path: string): Promise<FsResult<string>>;
  /** Tulis/truncate file. Tidak atomik; gunakan `src/fs/atomic.ts` bila perlu. */
  write(path: string, data: Uint8Array | string, options?: WriteOptions): Promise<FsResult<void>>;
  /**
   * Salin file atau pohon direktori secara fisik (dereference tautan internal)
   * ke `destination`. Destination tidak boleh ada. Tautan yang keluar dari akar
   * sumber ditolak dengan `unsafe_symlink`.
   */
  copy(source: string, destination: string): Promise<FsResult<void>>;
  /**
   * Hapus file/tautan, atau direktori bila `recursive`. Tidak pernah mengikuti
   * tautan: setiap entri diperiksa dengan `lstat`, tautan hanya di-unlink.
   */
  remove(path: string, options?: RemoveOptions): Promise<FsResult<void>>;
  /** Path kanonik (symlink/junction diikuti). */
  realpath(path: string): Promise<FsResult<string>>;
  /** Stat mengikuti tautan; tautan menggantung menghasilkan `not_found`. */
  stat(path: string): Promise<FsResult<FileStat>>;
  /** Stat tanpa mengikuti tautan; jenis `symlink` untuk junction/symlink. */
  lstat(path: string): Promise<FsResult<FileStat>>;
  /** Daftar isi direktori, terurut berdasarkan nama. Tidak memakai access(). */
  readdir(path: string): Promise<FsResult<DirEntry[]>>;
  mkdir(path: string, options?: MkdirOptions): Promise<FsResult<void>>;
  rename(from: string, to: string): Promise<FsResult<void>>;
  /**
   * true bila `lstat` berhasil — termasuk tautan menggantung. Gunakan `stat`
   * untuk mengetahui apakah target bisa dibaca.
   */
  exists(path: string): Promise<boolean>;
  /** Target mentah tautan (tidak di-resolve). */
  readlink(path: string): Promise<FsResult<string>>;
  /** Buat symlink/junction. Target boleh relatif terhadap induk tautan. */
  symlink(target: string, path: string, options?: SymlinkOptions): Promise<FsResult<void>>;
}
