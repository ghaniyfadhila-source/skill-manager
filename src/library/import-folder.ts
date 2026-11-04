/**
 * Impor skill dari folder lokal ke `<dataRoot>/library/<name>` (spec §10.2).
 *
 * Fungsi inti `importFromDirectory` sengaja tidak tahu dari mana folder
 * berasal: ticket 05 (git/zip) cukup mengekstrak ke direktori sementara lalu
 * memanggilnya dengan `provenance` yang sesuai.
 *
 * Tidak ada satu pun kode skill yang dieksekusi di sini (AC-10 / spec §13).
 */
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { SkillManagerError } from "../core/errors.js";
import { contentHash } from "../core/hash.js";
import { libraryRoot } from "../core/paths.js";
import { loadState, saveState } from "../core/state.js";
import type { Skill, SourceInfo, StateFile } from "../core/types.js";
import { TEMP_PREFIX } from "../fs/atomic.js";
import { guardStorePath } from "../fs/guard.js";
import type { FileSystem, FsError } from "../fs/types.js";
import { type WalkEntry, walkTree } from "../fs/walk.js";
import { type Frontmatter, OFFICIAL_FRONTMATTER_FIELDS, parseFrontmatter } from "./frontmatter.js";

/** Batas aman impor (spec §10.2). */
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
export const MAX_SOURCE_ENTRIES = 1000;

/** Nama file manifest skill di dalam folder sumber. */
export const SKILL_FILE_NAME = "SKILL.md";

/** Prefix id skill kanonik. */
export const SKILL_ID_PREFIX = "sk_";

/** Kode galat stabil modul impor. */
export type ImportErrorCode =
  | "source_not_found"
  | "source_not_directory"
  | "source_unreadable"
  | "source_too_many_files"
  | "source_too_large"
  | "skill_md_missing"
  | "frontmatter_invalid"
  | "name_missing"
  | "name_mismatch"
  | "invalid_name"
  | "name_conflict"
  | "unsafe_symlink"
  | "state_unsupported_version"
  | "import_failed";

export interface ImportDirectoryOptions {
  /** Folder sumber; boleh relatif, di-resolve terhadap cwd pemanggil. */
  readonly sourceDir: string;
  /** Provenance yang dicatat di state; untuk folder lihat `importFolderSkill`. */
  readonly provenance: SourceInfo;
  /**
   * Nama yang diharapkan. Default: nama folder sumber. Ticket 05 memakainya
   * karena folder sementara hasil clone/ekstrak tidak bernama seperti skill.
   */
  readonly name?: string;
  /** Generator id skill; disuntikkan test agar deterministik. */
  readonly newSkillId?: () => string;
  /** Sumber waktu impor; disuntikkan test agar deterministik. */
  readonly now?: () => string;
}

export interface ImportFolderOptions {
  readonly sourceDir: string;
  readonly newSkillId?: () => string;
  readonly now?: () => string;
}

export interface ImportResult {
  readonly skill: Skill;
  /** Peringatan non-fatal, mis. field frontmatter di luar 6 field resmi. */
  readonly warnings: readonly string[];
}

const SAFE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const LICENSE_FILE_PATTERN = /^licen[cs]e(\.(md|txt))?$/i;
const MAX_NAME_LENGTH = 100;

function importError(code: ImportErrorCode, message: string, details?: unknown): SkillManagerError {
  return new SkillManagerError({
    code,
    message,
    ...(details === undefined ? {} : { details }),
  });
}

/** Id skill kanonik: `sk_` + ULID (26 karakter Crockford base32). */
export function createSkillId(nowMs: number = Date.now()): string {
  const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let time = "";
  let remaining = nowMs;
  for (let index = 0; index < 10; index += 1) {
    time = `${crockford.charAt(remaining % 32)}${time}`;
    remaining = Math.floor(remaining / 32);
  }
  let randomness = "";
  for (const byte of randomBytes(16)) {
    randomness += crockford.charAt(byte % 32);
  }
  return `${SKILL_ID_PREFIX}${time}${randomness}`;
}

/** Impor dari folder lokal, mencatat provenance `folder` berisi path absolut. */
export async function importFolderSkill(
  fs: FileSystem,
  dataRoot: string,
  options: ImportFolderOptions,
): Promise<ImportResult> {
  return importFromDirectory(fs, dataRoot, {
    sourceDir: options.sourceDir,
    provenance: { type: "folder", path: path.resolve(options.sourceDir) },
    ...(options.newSkillId === undefined ? {} : { newSkillId: options.newSkillId }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}

/**
 * Impor isi sebuah direktori ke Library, lalu catat di `state.json`.
 *
 * Urutan: validasi (tanpa menulis apa pun) -> salin ke direktori sementara di
 * Library -> hash -> rename -> simpan state. Kegagalan di tengah membersihkan
 * sisa tulis sehingga Library dan state tetap konsisten.
 */
export async function importFromDirectory(
  fs: FileSystem,
  dataRoot: string,
  options: ImportDirectoryOptions,
): Promise<ImportResult> {
  const sourceDir = await resolveSourceDir(fs, options.sourceDir);
  const entries = await scanSource(fs, sourceDir);
  const frontmatter = await readFrontmatter(fs, sourceDir);
  const expectedName = options.name ?? path.basename(sourceDir);
  const name = requireName(frontmatter, expectedName);
  const warnings = collectWarnings(frontmatter);
  const license = await detectLicense(fs, sourceDir, entries, frontmatter);
  const state = await readState(fs, dataRoot);

  assertNoConflict(state.library, name);

  const libraryDir = libraryRoot(dataRoot);
  const destination = path.join(libraryDir, name);
  const contentHashValue = await copyIntoLibrary(fs, libraryDir, sourceDir, destination);

  const skill: Skill = {
    id: options.newSkillId?.() ?? createSkillId(),
    name,
    dirName: name,
    contentHash: contentHashValue,
    source: options.provenance,
    importedAt: options.now?.() ?? new Date().toISOString(),
    ...(license === undefined ? {} : { license }),
  };

  const saved = await saveState(fs, dataRoot, {
    ...state,
    library: [...state.library, skill],
  });
  if (!saved.ok) {
    await fs.remove(destination, { recursive: true });
    throw importError(
      "import_failed",
      `Gagal menyimpan state setelah menyalin skill: ${saved.error.message}`,
      saved.error,
    );
  }

  return { skill, warnings };
}

async function resolveSourceDir(fs: FileSystem, sourceDir: string): Promise<string> {
  const real = await fs.realpath(sourceDir);
  if (!real.ok) {
    throw importError(
      "source_not_found",
      `Folder sumber tidak bisa dibaca: ${sourceDir} (${real.error.code}).`,
      real.error,
    );
  }
  const stat = await fs.stat(real.value);
  if (!stat.ok) {
    throw importError(
      "source_not_found",
      `Folder sumber tidak bisa dibaca: ${sourceDir}.`,
      stat.error,
    );
  }
  if (stat.value.kind !== "directory") {
    throw importError("source_not_directory", `Sumber impor bukan folder: ${sourceDir}.`);
  }
  return real.value;
}

/**
 * Telusuri folder sumber dengan batas aman. Bila batas terlampaui, penelusuran
 * diulang tanpa batas byte untuk memisahkan penyebabnya menjadi kode stabil.
 */
async function scanSource(fs: FileSystem, sourceDir: string): Promise<readonly WalkEntry[]> {
  const walked = await walkTree(fs, sourceDir, {
    maxEntries: MAX_SOURCE_ENTRIES,
    maxBytes: MAX_SOURCE_BYTES,
  });
  if (walked.ok) {
    return walked.value;
  }
  if (walked.error.code !== "io_error") {
    throw importError(
      "source_unreadable",
      `Folder sumber tidak bisa ditelusuri: ${walked.error.message}`,
      walked.error,
    );
  }

  const counted = await walkTree(fs, sourceDir, { maxEntries: MAX_SOURCE_ENTRIES });
  if (!counted.ok) {
    throw importError(
      "source_too_many_files",
      `Folder sumber melebihi batas ${MAX_SOURCE_ENTRIES} entri. Impor ditolak.`,
    );
  }
  throw importError(
    "source_too_large",
    `Ukuran folder sumber melebihi batas ${MAX_SOURCE_BYTES} byte (10 MiB). Impor ditolak.`,
  );
}

async function readFrontmatter(fs: FileSystem, sourceDir: string): Promise<Frontmatter> {
  const skillFilePath = path.join(sourceDir, SKILL_FILE_NAME);
  const text = await fs.readText(skillFilePath);
  if (!text.ok) {
    if (text.error.code === "not_found") {
      throw importError(
        "skill_md_missing",
        `Folder sumber tidak berisi ${SKILL_FILE_NAME}: ${skillFilePath}.`,
      );
    }
    throw importError(
      "source_unreadable",
      `${SKILL_FILE_NAME} tidak bisa dibaca: ${text.error.message}`,
      text.error,
    );
  }
  return parseFrontmatter(text.value);
}

function requireName(frontmatter: Frontmatter, expectedName: string): string {
  const raw = frontmatter.data.name;
  if (raw === undefined) {
    throw importError(
      "name_missing",
      `Frontmatter ${SKILL_FILE_NAME} tidak memiliki field "name".`,
    );
  }
  if (typeof raw !== "string") {
    throw importError(
      "frontmatter_invalid",
      `Field "name" pada ${SKILL_FILE_NAME} harus berupa teks, bukan blok bertingkat.`,
    );
  }

  const name = raw.trim();
  if (name === "") {
    throw importError("name_missing", `Field "name" pada ${SKILL_FILE_NAME} kosong.`);
  }
  if (
    name.length > MAX_NAME_LENGTH ||
    !SAFE_NAME_PATTERN.test(name) ||
    name === "." ||
    name === ".."
  ) {
    throw importError(
      "invalid_name",
      `Nama skill "${name}" tidak aman dipakai sebagai nama folder Library (hanya huruf, angka, ".", "_", "-").`,
    );
  }
  if (name !== expectedName) {
    throw importError(
      "name_mismatch",
      `Nama skill di frontmatter ("${name}") tidak sama dengan nama folder sumber ("${expectedName}").`,
    );
  }
  return name;
}

function collectWarnings(frontmatter: Frontmatter): readonly string[] {
  const official: readonly string[] = OFFICIAL_FRONTMATTER_FIELDS;
  return Object.keys(frontmatter.data)
    .filter((field) => !official.includes(field))
    .map(
      (field) =>
        `Field frontmatter "${field}" di luar 6 field resmi; diterima, tetapi tidak dipakai v0.1.`,
    );
}

async function detectLicense(
  fs: FileSystem,
  sourceDir: string,
  entries: readonly WalkEntry[],
  frontmatter: Frontmatter,
): Promise<string | undefined> {
  const declared = frontmatter.data.license;
  if (typeof declared === "string" && declared.trim() !== "") {
    return declared.trim();
  }

  const licenseEntry = entries.find(
    (entry) =>
      entry.kind === "file" &&
      !entry.isSymlink &&
      !entry.relativePath.includes("/") &&
      LICENSE_FILE_PATTERN.test(entry.relativePath),
  );
  if (licenseEntry === undefined) {
    return undefined;
  }

  const text = await fs.readText(path.join(sourceDir, licenseEntry.relativePath));
  if (!text.ok) {
    return undefined;
  }
  const firstLine = text.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== "");
  return firstLine === undefined || firstLine === "" ? undefined : firstLine.slice(0, 200);
}

async function readState(fs: FileSystem, dataRoot: string): Promise<StateFile> {
  const loaded = await loadState(fs, dataRoot);
  if (loaded.status === "unsupported_version") {
    throw importError(
      "state_unsupported_version",
      loaded.reason ?? "state.json dibuat versi aplikasi yang lebih baru.",
    );
  }
  return loaded.state;
}

function conflictError(name: string, existingId?: string): SkillManagerError {
  return importError(
    "name_conflict",
    `Skill "${name}" sudah ada di Library. Impor ditolak; tidak ada penimpaan.`,
    existingId === undefined ? undefined : { existing: name, existingId },
  );
}

function assertNoConflict(library: readonly Skill[], name: string): void {
  const existing = library.find((skill) => skill.name === name || skill.dirName === name);
  if (existing !== undefined) {
    throw conflictError(name, existing.id);
  }
}

/**
 * Salin folder sumber ke Library lewat direktori sementara di dalam Library,
 * lalu rename. Mengembalikan hash isi Library.
 */
async function copyIntoLibrary(
  fs: FileSystem,
  libraryDir: string,
  sourceDir: string,
  destination: string,
): Promise<string> {
  const created = await fs.mkdir(libraryDir, { recursive: true });
  if (!created.ok) {
    throw importError(
      "import_failed",
      `Tidak bisa menyiapkan folder Library: ${created.error.message}`,
      created.error,
    );
  }

  const guarded = await guardStorePath(fs, libraryDir, destination);
  if (!guarded.ok) {
    throw importError(
      "import_failed",
      `Tujuan impor tidak aman: ${guarded.error.message}`,
      guarded.error,
    );
  }
  if (await fs.exists(destination)) {
    throw conflictError(path.basename(destination));
  }

  const tempDir = path.join(libraryDir, `${TEMP_PREFIX}${randomUUID()}`);
  const copied = await fs.copy(sourceDir, tempDir);
  if (!copied.ok) {
    await fs.remove(tempDir, { recursive: true });
    throw copyError(copied.error);
  }

  const hashed = await contentHash(fs, tempDir);
  if (!hashed.ok) {
    await fs.remove(tempDir, { recursive: true });
    throw importError(
      "import_failed",
      `Gagal menghitung hash skill: ${hashed.error.message}`,
      hashed.error,
    );
  }

  const renamed = await fs.rename(tempDir, destination);
  if (!renamed.ok) {
    await fs.remove(tempDir, { recursive: true });
    throw importError(
      "import_failed",
      `Gagal memindahkan skill ke Library: ${renamed.error.message}`,
      renamed.error,
    );
  }
  return hashed.value;
}

function copyError(error: FsError): SkillManagerError {
  if (error.code === "unsafe_symlink") {
    return importError(
      "unsafe_symlink",
      `Tautan di dalam folder sumber menunjuk keluar folder sumber: ${error.path}. Impor ditolak.`,
      error,
    );
  }
  if (error.code === "already_exists") {
    return importError("name_conflict", "Tujuan impor sudah ada di Library; impor ditolak.", error);
  }
  return importError("import_failed", `Gagal menyalin skill ke Library: ${error.message}`, error);
}
