/**
 * Sumber impor yang sudah diunduh/diekstrak tetapi BELUM diimpor (spec §13).
 *
 * Spec mewajibkan pohon file, ukuran, lisensi, dan penanda risiko ditampilkan
 * SEBELUM konfirmasi. Untuk folder itu bisa langsung dibaca, tetapi git dan zip
 * harus diunduh dulu — jadi hasil unduhan disimpan di `staging` dan pratinjau
 * dibaca dari sana. Impor kedua langkah memakai direktori yang sama, sehingga
 * yang dipratinjau dan yang diimpor dijamin isi yang sama.
 *
 * Staging sengaja TIDAK di dalam Store: ia bukan Installation, tidak boleh
 * terlihat harness mana pun, dan tidak dihitung drift.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { SkillManagerError } from "../core/errors.js";
import type { SourceInfo } from "../core/types.js";
import type { ProcessRunner } from "../fs/process.js";
import type { FileSystem } from "../fs/types.js";
import { type ImportResult, importFromDirectory } from "./import-folder.js";
import { cloneGitTo } from "./import-git.js";
import { extractZipTo } from "./import-zip.js";
import { type InspectResult, inspectSource } from "./inspect.js";
import { findSkillDirectory, readSkillName } from "./skill-source.js";

/** Prefix direktori staging di dalam data root; bukan bagian dari state.json. */
export const STAGING_DIR_NAME = "staging";
const STAGING_PREFIX = "stg_";
const META_FILE_NAME = "meta.json";

export type StagingErrorCode =
  | "staging_not_found"
  | "staging_invalid"
  | "staging_expired"
  | "source_type_unsupported";

function stagingError(
  code: StagingErrorCode,
  message: string,
  details?: unknown,
): SkillManagerError {
  return new SkillManagerError({ code, message, ...(details === undefined ? {} : { details }) });
}

/** Metadata yang disimpan bersama isi staging agar bertahan lintas request. */
interface StagingMeta {
  readonly provenance: SourceInfo;
  readonly suggestedName: string;
  readonly createdAt: string;
}

export interface StagedSource {
  readonly stagingId: string;
  readonly inspect: InspectResult;
  readonly provenance: SourceInfo;
  readonly suggestedName: string;
}

export interface StageOptions {
  /** Generator id; disuntikkan test agar deterministik. */
  readonly newStagingId?: () => string;
  /** Sumber waktu ISO; disuntikkan test agar deterministik. */
  readonly now?: () => string;
}

function stagingRoot(dataRoot: string): string {
  return path.join(dataRoot, STAGING_DIR_NAME);
}

/** Id staging harus satu segmen aman: dipakai sebagai nama direktori. */
function assertStagingId(stagingId: string): void {
  if (!/^stg_[A-Za-z0-9-]+$/.test(stagingId)) {
    throw stagingError("staging_invalid", `Id staging tidak valid: "${stagingId}".`);
  }
}

function newId(options: StageOptions): string {
  const raw = (options.newStagingId ?? (() => randomUUID()))();
  const stagingId = `${STAGING_PREFIX}${raw}`;
  assertStagingId(stagingId);
  return stagingId;
}

async function prepare(
  fs: FileSystem,
  dataRoot: string,
  options: StageOptions,
): Promise<{ stagingId: string; root: string }> {
  const stagingId = newId(options);
  const root = path.join(stagingRoot(dataRoot), stagingId);
  const created = await fs.mkdir(root, { recursive: true });
  if (!created.ok) {
    throw stagingError(
      "staging_invalid",
      `Direktori staging tidak bisa dibuat: ${created.error.message}`,
      created.error,
    );
  }
  return { stagingId, root };
}

/**
 * Tulis metadata ke AKAR staging (bukan ke folder skill) lalu bangun pratinjau.
 * Metadata harus di akar agar `readStaged` menemukannya walau sumber punya satu
 * folder pembungkus.
 */
async function finalize(
  fs: FileSystem,
  root: string,
  skillDir: string,
  stagingId: string,
  provenance: SourceInfo,
  options: StageOptions,
): Promise<StagedSource> {
  const suggestedName = await readSkillName(fs, skillDir);
  const inspect = await inspectSource(fs, skillDir);
  const meta: StagingMeta = {
    provenance,
    suggestedName,
    createdAt: (options.now ?? (() => new Date().toISOString()))(),
  };
  const written = await fs.write(`${root}/${META_FILE_NAME}`, `${JSON.stringify(meta)}\n`);
  if (!written.ok) {
    throw stagingError("staging_invalid", "Metadata staging tidak bisa ditulis.", written.error);
  }
  return { stagingId, inspect, provenance, suggestedName };
}

/** Salin folder lokal ke staging, lalu pratinjau. */
export async function stageFromFolder(
  fs: FileSystem,
  dataRoot: string,
  sourceDir: string,
  options: StageOptions = {},
): Promise<StagedSource> {
  const { stagingId, root } = await prepare(fs, dataRoot, options);
  const target = path.join(root, "source");
  try {
    const copied = await fs.copy(path.resolve(sourceDir), target);
    if (!copied.ok) {
      throw copied.error;
    }
    const provenance: SourceInfo = { type: "folder", path: path.resolve(sourceDir) };
    return await finalize(fs, root, target, stagingId, provenance, options);
  } catch (error) {
    // Staging yang gagal disiapkan tidak boleh tertinggal.
    await fs.remove(root, { recursive: true });
    throw error;
  }
}

/** Clone dangkal ke staging, lalu pratinjau. Tidak mengimpor apa pun. */
export async function stageFromGit(
  fs: FileSystem,
  dataRoot: string,
  runner: ProcessRunner,
  input: { readonly url: string; readonly ref?: string },
  options: StageOptions = {},
): Promise<StagedSource> {
  const { stagingId, root } = await prepare(fs, dataRoot, options);
  try {
    const cloned = await cloneGitTo(runner, input, root);
    const skillDir = await findSkillDirectory(fs, root);
    const provenance: SourceInfo = {
      type: "git",
      url: cloned.url,
      ref: cloned.ref,
      commit: cloned.commit,
    };
    return await finalize(fs, root, skillDir, stagingId, provenance, options);
  } catch (error) {
    await fs.remove(root, { recursive: true });
    throw error;
  }
}

/** Ekstrak zip ke staging, lalu pratinjau. Tidak mengimpor apa pun. */
export async function stageFromZip(
  fs: FileSystem,
  dataRoot: string,
  zipPath: string,
  options: StageOptions = {},
): Promise<StagedSource> {
  const { stagingId, root } = await prepare(fs, dataRoot, options);
  try {
    await extractZipTo(fs, zipPath, root);
    const skillDir = await findSkillDirectory(fs, root);
    const provenance: SourceInfo = { type: "zip", path: path.resolve(zipPath) };
    return await finalize(fs, root, skillDir, stagingId, provenance, options);
  } catch (error) {
    await fs.remove(root, { recursive: true });
    throw error;
  }
}

/** Baca kembali staging yang dibuat request sebelumnya. */
export async function readStaged(fs: FileSystem, dataRoot: string, stagingId: string) {
  assertStagingId(stagingId);
  const root = path.join(stagingRoot(dataRoot), stagingId);
  const raw = await fs.readText(path.join(root, META_FILE_NAME));
  if (!raw.ok) {
    throw stagingError(
      "staging_not_found",
      `Staging "${stagingId}" tidak ditemukan atau sudah kedaluwarsa. Ulangi pratinjau.`,
    );
  }
  let meta: StagingMeta;
  try {
    meta = JSON.parse(raw.value) as StagingMeta;
  } catch {
    throw stagingError("staging_invalid", `Metadata staging "${stagingId}" rusak.`);
  }
  const skillDir = await findSkillDirectory(fs, root);
  const inspect = await inspectSource(fs, skillDir);
  return { stagingId, root, skillDir, meta, inspect };
}

/** Impor dari staging lalu HAPUS staging (berhasil maupun gagal). */
export async function importStaged(
  fs: FileSystem,
  dataRoot: string,
  stagingId: string,
  options: { readonly newSkillId?: () => string; readonly now?: () => string } = {},
): Promise<ImportResult> {
  const staged = await readStaged(fs, dataRoot, stagingId);
  try {
    const skillDir = await findSkillDirectory(fs, staged.root);
    return await importFromDirectory(fs, dataRoot, {
      sourceDir: skillDir,
      provenance: staged.meta.provenance,
      name: staged.meta.suggestedName,
      ...(options.newSkillId === undefined ? {} : { newSkillId: options.newSkillId }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  } finally {
    await fs.remove(staged.root, { recursive: true });
  }
}

/** Buang staging tanpa mengimpor (user membatalkan pratinjau). */
export async function discardStaged(
  fs: FileSystem,
  dataRoot: string,
  stagingId: string,
): Promise<void> {
  assertStagingId(stagingId);
  await fs.remove(path.join(stagingRoot(dataRoot), stagingId), { recursive: true });
}

/**
 * Hapus staging yang lebih tua dari `maxAgeMs`. Sisa bisa ada bila proses mati
 * antara pratinjau dan impor; panggil saat startup atau dari `doctor`.
 */
export async function cleanStaleStaging(
  fs: FileSystem,
  dataRoot: string,
  maxAgeMs = 24 * 60 * 60 * 1000,
  now: () => number = () => Date.now(),
): Promise<readonly string[]> {
  const root = stagingRoot(dataRoot);
  const listing = await fs.readdir(root);
  if (!listing.ok) {
    return [];
  }
  const removed: string[] = [];
  for (const entry of listing.value) {
    if (entry.kind !== "directory" || !entry.name.startsWith(STAGING_PREFIX)) {
      continue;
    }
    const target = path.join(root, entry.name);
    const raw = await fs.readText(path.join(target, META_FILE_NAME));
    let createdAt = Number.NaN;
    if (raw.ok) {
      try {
        createdAt = Date.parse((JSON.parse(raw.value) as StagingMeta).createdAt);
      } catch {
        createdAt = Number.NaN;
      }
    }
    // Metadata rusak/hilang dianggap kedaluwarsa: lebih baik dibuang.
    if (Number.isNaN(createdAt) || now() - createdAt > maxAgeMs) {
      await fs.remove(target, { recursive: true });
      removed.push(target);
    }
  }
  return removed;
}
