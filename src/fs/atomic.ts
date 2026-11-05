import { randomUUID } from "node:crypto";
import path from "node:path";
import { type FileSystem, type FsResult, fsErr, fsOk } from "./types.js";

/** Prefix direktori sementara di dalam Store (spec §14). */
export const TEMP_PREFIX = ".skill-manager-tmp-";

/** Suffix file sementara untuk state.json (spec §9). */
export const TEMP_FILE_SUFFIX = ".tmp";

export interface AtomicFileOptions {
  readonly tempSuffix?: string;
}

export interface AtomicDirectoryOptions {
  readonly tempPrefix?: string;
  /** Bisa disuntikkan test; default `crypto.randomUUID`. */
  readonly randomSuffix?: () => string;
}

export type PopulateTempDirectory = (tempDir: string) => Promise<FsResult<void>>;

async function cleanup(fs: FileSystem, targetPath: string): Promise<void> {
  await fs.remove(targetPath, { recursive: true });
}

/**
 * Tulis file secara atomik: isi ditulis ke `<target>.tmp`, lalu rename.
 * Bila salah satu langkah gagal, file sementara dibersihkan dan file lama
 * dibiarkan utuh. Dipakai state.json (spec §9).
 */
export async function writeFileAtomic(
  fs: FileSystem,
  targetPath: string,
  data: Uint8Array | string,
  options: AtomicFileOptions = {},
): Promise<FsResult<void>> {
  const tempPath = `${targetPath}${options.tempSuffix ?? TEMP_FILE_SUFFIX}`;
  const written = await fs.write(tempPath, data);
  if (!written.ok) {
    await cleanup(fs, tempPath);
    return written;
  }

  const renamed = await fs.rename(tempPath, targetPath);
  if (!renamed.ok) {
    await cleanup(fs, tempPath);
    return renamed;
  }
  return fsOk(undefined);
}

/**
 * Tulis direktori secara atomik di dalam Store:
 * 1. buat `<parent>/.skill-manager-tmp-<acak>`;
 * 2. panggil `populate(tempDir)` untuk mengisi salinan;
 * 3. rename direktori sementara ke target.
 *
 * Pada kegagalan apa pun direktori sementara dihapus dan target tidak dibuat.
 * Target yang sudah ada tidak pernah ditimpa.
 */
export async function writeDirectoryAtomic(
  fs: FileSystem,
  targetPath: string,
  populate: PopulateTempDirectory,
  options: AtomicDirectoryOptions = {},
): Promise<FsResult<void>> {
  const absoluteTarget = path.resolve(targetPath);
  const parent = path.dirname(absoluteTarget);
  const parentStat = await fs.stat(parent);
  if (!parentStat.ok) {
    return parentStat;
  }
  if (parentStat.value.kind !== "directory") {
    return fsErr("not_a_directory", parent, "Induk target atomic bukan direktori.");
  }
  if (await fs.exists(absoluteTarget)) {
    return fsErr("already_exists", absoluteTarget, "Target atomic sudah ada.");
  }

  const suffix = options.randomSuffix?.() ?? randomUUID();
  const tempDir = path.join(parent, `${options.tempPrefix ?? TEMP_PREFIX}${suffix}`);
  const created = await fs.mkdir(tempDir);
  if (!created.ok) {
    return created;
  }

  let populated: FsResult<void>;
  try {
    populated = await populate(tempDir);
  } catch (error) {
    await cleanup(fs, tempDir);
    return fsErr("io_error", tempDir, "Gagal mengisi direktori sementara.", error);
  }
  if (!populated.ok) {
    await cleanup(fs, tempDir);
    return populated;
  }

  const renamed = await fs.rename(tempDir, absoluteTarget);
  if (!renamed.ok) {
    await cleanup(fs, tempDir);
    return renamed;
  }
  return fsOk(undefined);
}
