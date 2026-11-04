/**
 * Impor skill dari arsip zip (spec §10.2, AC-3).
 *
 * Arsip adalah masukan TIDAK DIPERCAYA, jadi modul ini membaca central
 * directory zip sendiri (tanpa dependensi npm dan tanpa binary eksternal),
 * memvalidasi SEMUA entri lebih dulu, baru mengekstrak:
 *
 * - nama absolut (termasuk drive letter) dan segmen ".." ditolak;
 * - entri symlink dan tipe khusus (device/FIFO) ditolak;
 * - batas jumlah entri dan ukuran memakai konstanta yang sama dengan impor
 *   folder (MAX_SOURCE_ENTRIES / MAX_SOURCE_BYTES);
 * - setiap entri didekompresi dengan batas keluaran agar zip bomb tidak
 *   menghabiskan memori, dan CRC diverifikasi.
 *
 * Setelah ekstrak, isi diserahkan ke importFromDirectory dengan provenance zip.
 * Tidak ada kode skill yang dieksekusi.
 */
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { crc32, inflateRawSync } from "node:zlib";
import { SkillManagerError } from "../core/errors.js";
import type { SourceInfo } from "../core/types.js";
import { isPathInside } from "../fs/guard.js";
import type { FileSystem } from "../fs/types.js";
import {
  type ImportResult,
  importFromDirectory,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_ENTRIES,
} from "./import-folder.js";
import { findSkillDirectory, readSkillName } from "./skill-source.js";

/** Kode galat stabil modul impor zip. */
export type ZipImportErrorCode =
  | "zip_invalid"
  | "zip_unsupported"
  | "unsafe_zip_entry"
  | "unsafe_symlink"
  | "source_unreadable"
  | "source_too_many_files"
  | "source_too_large"
  | "zip_extract_failed";

export interface ImportZipOptions {
  /** Path arsip zip; boleh relatif. */
  readonly zipPath: string;
  /** Induk direktori sementara; default os.tmpdir(). */
  readonly tempRoot?: string;
  /** Nama satu segmen direktori sementara; disuntikkan test agar deterministik. */
  readonly newTempDirName?: () => string;
  /** Generator id skill; disuntikkan test agar deterministik. */
  readonly newSkillId?: () => string;
  /** Sumber waktu impor; disuntikkan test agar deterministik. */
  readonly now?: () => string;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const CENTRAL_MIN_SIZE = 46;
const LOCAL_MIN_SIZE = 30;
const MAX_COMMENT_LENGTH = 0xffff;
const ZIP64_SENTINEL = 0xffffffff;
const ZIP64_ENTRY_COUNT = 0xffff;
const FILE_TYPE_MASK = 0o170000;
const REGULAR_FILE = 0o100000;
const DIRECTORY = 0o040000;
const SYMLINK = 0o120000;
const DEFAULT_FILE_MODE = 0o644;

interface ZipEntry {
  /** Nama ternormalisasi dengan pemisah "/" tanpa garis miring akhir. */
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly crc: number;
  readonly localOffset: number;
  /** Bit izin Unix; 0 bila arsip tidak menyimpannya. */
  readonly permissions: number;
  readonly isDirectory: boolean;
}

function zipError(code: ZipImportErrorCode, message: string, details?: unknown): SkillManagerError {
  return new SkillManagerError({ code, message, ...(details === undefined ? {} : { details }) });
}

function invalid(message: string): SkillManagerError {
  return zipError("zip_invalid", message);
}

function readU16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] as number) | ((bytes[offset + 1] as number) << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] as number) |
      ((bytes[offset + 1] as number) << 8) |
      ((bytes[offset + 2] as number) << 16) |
      ((bytes[offset + 3] as number) << 24)) >>>
    0
  );
}

/** Cari End of Central Directory; komentar arsip boleh ada di belakangnya. */
function findEndOfCentralDirectory(bytes: Uint8Array): number {
  if (bytes.length < EOCD_MIN_SIZE) {
    throw invalid("Berkas terlalu kecil untuk sebuah arsip zip.");
  }
  const earliest = Math.max(0, bytes.length - EOCD_MIN_SIZE - MAX_COMMENT_LENGTH);
  for (let offset = bytes.length - EOCD_MIN_SIZE; offset >= earliest; offset -= 1) {
    if (readU32(bytes, offset) !== EOCD_SIGNATURE) {
      continue;
    }
    const commentLength = readU16(bytes, offset + 20);
    if (offset + EOCD_MIN_SIZE + commentLength <= bytes.length) {
      return offset;
    }
  }
  throw invalid("Tidak menemukan End of Central Directory; berkas bukan zip yang valid.");
}

function decodeEntryName(raw: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    throw zipError(
      "zip_unsupported",
      "Nama entri zip bukan UTF-8; arsip dengan nama CP437 tidak didukung.",
    );
  }
}

/**
 * Validasi dan normalisasi nama entri. Menolak path absolut (termasuk drive
 * letter Windows), pemisah Windows, dan segmen ".." sebelum apa pun ditulis.
 */
function normalizeEntryName(raw: string): string {
  if (raw === "") {
    throw invalid("Arsip berisi entri tanpa nama.");
  }
  if (raw.includes("\u0000")) {
    throw invalid("Nama entri zip mengandung byte NUL.");
  }
  if (raw.includes("\\")) {
    throw zipError(
      "unsafe_zip_entry",
      `Entri zip memakai pemisah Windows: "${raw}". Hanya "/" yang diterima.`,
    );
  }
  if (raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) {
    throw zipError("unsafe_zip_entry", `Entri zip memakai path absolut: "${raw}". Impor ditolak.`);
  }
  const segments = raw.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw zipError(
      "unsafe_zip_entry",
      `Entri zip menunjuk keluar folder tujuan: "${raw}". Impor ditolak.`,
    );
  }

  const normalized = path.posix.normalize(raw);
  if (normalized === "." || normalized === "") {
    return "";
  }
  if (normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/")) {
    throw zipError(
      "unsafe_zip_entry",
      `Entri zip menunjuk keluar folder tujuan: "${raw}". Impor ditolak.`,
    );
  }
  return normalized;
}

function assertSingleDisk(
  bytes: Uint8Array,
  eocd: number,
): {
  entriesTotal: number;
  cdSize: number;
  cdOffset: number;
} {
  const diskNumber = readU16(bytes, eocd + 4);
  const cdStartDisk = readU16(bytes, eocd + 6);
  const entriesOnDisk = readU16(bytes, eocd + 8);
  const entriesTotal = readU16(bytes, eocd + 10);
  const cdSize = readU32(bytes, eocd + 12);
  const cdOffset = readU32(bytes, eocd + 16);

  if (diskNumber !== 0 || cdStartDisk !== 0 || entriesOnDisk !== entriesTotal) {
    throw zipError("zip_unsupported", "Arsip zip multi-disk tidak didukung.");
  }
  if (
    entriesTotal === ZIP64_ENTRY_COUNT ||
    cdSize === ZIP64_SENTINEL ||
    cdOffset === ZIP64_SENTINEL
  ) {
    throw zipError("zip_unsupported", "Arsip zip64 tidak didukung v0.1.");
  }
  if (cdOffset + cdSize > bytes.length) {
    throw invalid("Central directory zip melewati akhir berkas.");
  }
  return { entriesTotal, cdSize, cdOffset };
}

/**
 * Baca dan validasi seluruh central directory. Tidak menulis apa pun; pemanggil
 * baru mengekstrak setelah fungsi ini selesai tanpa galat.
 */
function parseZipEntries(bytes: Uint8Array): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(bytes);
  const { entriesTotal, cdSize, cdOffset } = assertSingleDisk(bytes, eocd);

  const entries: ZipEntry[] = [];
  const fileNames = new Set<string>();
  let cursor = cdOffset;

  for (let index = 0; index < entriesTotal; index += 1) {
    if (cursor + CENTRAL_MIN_SIZE > bytes.length) {
      throw invalid("Entri central directory terpotong.");
    }
    if (readU32(bytes, cursor) !== CENTRAL_SIGNATURE) {
      throw invalid("Tanda tangan central directory tidak dikenal.");
    }

    const flags = readU16(bytes, cursor + 8);
    const method = readU16(bytes, cursor + 10);
    const crc = readU32(bytes, cursor + 16);
    const compressedSize = readU32(bytes, cursor + 20);
    const uncompressedSize = readU32(bytes, cursor + 24);
    const nameLength = readU16(bytes, cursor + 28);
    const extraLength = readU16(bytes, cursor + 30);
    const commentLength = readU16(bytes, cursor + 32);
    const externalAttributes = readU32(bytes, cursor + 38);
    const localOffset = readU32(bytes, cursor + 42);

    const next = cursor + CENTRAL_MIN_SIZE + nameLength + extraLength + commentLength;
    if (next > cdOffset + cdSize || next > bytes.length) {
      throw invalid("Central directory zip melewati batas arsip.");
    }
    if ((flags & 0x1) !== 0) {
      throw zipError("zip_unsupported", "Arsip zip terenkripsi tidak didukung.");
    }
    if (
      compressedSize === ZIP64_SENTINEL ||
      uncompressedSize === ZIP64_SENTINEL ||
      localOffset === ZIP64_SENTINEL ||
      nameLength === ZIP64_ENTRY_COUNT
    ) {
      throw zipError("zip_unsupported", "Entri zip64 tidak didukung v0.1.");
    }

    const rawName = decodeEntryName(
      bytes.subarray(cursor + CENTRAL_MIN_SIZE, cursor + CENTRAL_MIN_SIZE + nameLength),
    );
    const name = normalizeEntryName(rawName);

    const unixMode = (externalAttributes >>> 16) & 0xffff;
    const fileType = unixMode & FILE_TYPE_MASK;
    const isDirectory =
      rawName.endsWith("/") || (externalAttributes & 0x10) !== 0 || fileType === DIRECTORY;

    if (fileType === SYMLINK) {
      throw zipError("unsafe_symlink", `Entri zip adalah tautan ("${rawName}"). Impor ditolak.`);
    }
    if (fileType !== 0 && fileType !== REGULAR_FILE && fileType !== DIRECTORY) {
      throw zipError("zip_unsupported", `Entri zip bertipe khusus ("${rawName}") tidak didukung.`);
    }
    if (name === "") {
      cursor = next;
      continue;
    }

    if (!isDirectory) {
      if (fileNames.has(name)) {
        throw invalid(`Arsip berisi entri ganda: "${name}".`);
      }
      fileNames.add(name);
    }

    entries.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      crc,
      localOffset,
      permissions: unixMode & 0o777,
      isDirectory,
    });
    cursor = next;
  }

  return entries;
}

function assertLimits(archiveSize: number, entries: readonly ZipEntry[]): void {
  if (archiveSize > MAX_SOURCE_BYTES) {
    throw zipError(
      "source_too_large",
      `Berkas zip melebihi batas ${MAX_SOURCE_BYTES} byte (10 MiB). Impor ditolak.`,
    );
  }
  if (entries.length > MAX_SOURCE_ENTRIES) {
    throw zipError(
      "source_too_many_files",
      `Arsip zip melebihi batas ${MAX_SOURCE_ENTRIES} entri. Impor ditolak.`,
    );
  }

  let total = 0;
  for (const entry of entries) {
    if (entry.isDirectory) {
      continue;
    }
    total += entry.uncompressedSize;
    if (total > MAX_SOURCE_BYTES) {
      throw zipError(
        "source_too_large",
        `Isi zip melebihi batas ${MAX_SOURCE_BYTES} byte (10 MiB) setelah diekstrak. Impor ditolak.`,
      );
    }
  }
}

function entryData(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  if (entry.localOffset + LOCAL_MIN_SIZE > bytes.length) {
    throw invalid(`Local header entri "${entry.name}" terpotong.`);
  }
  if (readU32(bytes, entry.localOffset) !== LOCAL_SIGNATURE) {
    throw invalid(`Local header entri "${entry.name}" tidak dikenal.`);
  }
  const nameLength = readU16(bytes, entry.localOffset + 26);
  const extraLength = readU16(bytes, entry.localOffset + 28);
  const start = entry.localOffset + LOCAL_MIN_SIZE + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > bytes.length) {
    throw invalid(`Data entri "${entry.name}" melewati akhir berkas.`);
  }
  const compressed = bytes.subarray(start, end);

  if (entry.method === 0) {
    if (compressed.length !== entry.uncompressedSize) {
      throw invalid(`Ukuran entri "${entry.name}" tidak cocok dengan central directory.`);
    }
    return compressed;
  }
  if (entry.method !== 8) {
    throw zipError(
      "zip_unsupported",
      `Metode kompresi ${entry.method} pada entri "${entry.name}" tidak didukung (hanya stored/deflate).`,
    );
  }

  let data: Uint8Array;
  try {
    data = inflateRawSync(compressed, {
      maxOutputLength: Math.max(1, entry.uncompressedSize),
    });
  } catch {
    throw invalid(
      `Entri "${entry.name}" tidak bisa didekompresi atau melebihi ukuran yang dideklarasikan.`,
    );
  }
  if (data.length !== entry.uncompressedSize) {
    throw invalid(`Ukuran entri "${entry.name}" tidak cocok dengan central directory.`);
  }
  return new Uint8Array(data);
}

/** Tulis satu entri yang sudah lolos validasi; tetap dicek berada di dalam tujuan. */
async function writeEntry(
  fs: FileSystem,
  bytes: Uint8Array,
  entry: ZipEntry,
  destination: string,
): Promise<void> {
  const target = path.join(destination, ...entry.name.split("/"));
  if (!isPathInside(destination, target)) {
    throw zipError(
      "unsafe_zip_entry",
      `Entri zip menunjuk keluar folder tujuan: "${entry.name}". Impor ditolak.`,
    );
  }

  if (entry.isDirectory) {
    const created = await fs.mkdir(target, { recursive: true });
    if (!created.ok) {
      throw extractError(created.error.message, created.error);
    }
    return;
  }

  const data = entryData(bytes, entry);
  if (crc32(data) !== entry.crc) {
    throw invalid(`CRC entri "${entry.name}" tidak cocok; arsip rusak.`);
  }

  const parent = await fs.mkdir(path.dirname(target), { recursive: true });
  if (!parent.ok) {
    throw extractError(parent.error.message, parent.error);
  }
  const written = await fs.write(target, data, {
    mode: entry.permissions === 0 ? DEFAULT_FILE_MODE : entry.permissions,
  });
  if (!written.ok) {
    throw extractError(written.error.message, written.error);
  }
}

function extractError(message: string, cause?: unknown): SkillManagerError {
  return zipError(
    "zip_extract_failed",
    `Gagal mengekstrak arsip zip ke direktori sementara: ${message}`,
    cause,
  );
}

function tempDirectory(options: ImportZipOptions): string {
  const name = (options.newTempDirName ?? (() => `skill-manager-zip-${randomUUID()}`))();
  // Satu segmen saja, dan bukan "..": finally di bawah menghapus rekursif, jadi
  // nama yang salah bisa menghapus direktori di luar induk sementara.
  if (name === "" || name === "." || name === ".." || /[\\/:]/.test(name)) {
    throw extractError(`Nama direktori sementara tidak aman: "${name}".`);
  }
  return path.join(options.tempRoot ?? os.tmpdir(), name);
}

/**
 * Impor skill dari arsip zip ke Library. Direktori sementara selalu dibersihkan,
 * baik impor berhasil maupun gagal (sisa bila proses mati dibersihkan doctor).
 */
export async function importZipSkill(
  fs: FileSystem,
  dataRoot: string,
  options: ImportZipOptions,
): Promise<ImportResult> {
  const zipPath = path.resolve(options.zipPath);
  const archive = await fs.read(zipPath);
  if (!archive.ok) {
    throw zipError(
      "source_unreadable",
      `Arsip zip tidak bisa dibaca: ${zipPath} (${archive.error.code}).`,
      archive.error,
    );
  }

  // Validasi penuh sebelum satu byte pun ditulis ke disk.
  const entries = parseZipEntries(archive.value);
  assertLimits(archive.value.length, entries);

  const tempDir = tempDirectory(options);
  try {
    const created = await fs.mkdir(tempDir, { recursive: true });
    if (!created.ok) {
      throw extractError(created.error.message, created.error);
    }
    for (const entry of entries) {
      await writeEntry(fs, archive.value, entry, tempDir);
    }

    const skillDir = await findSkillDirectory(fs, tempDir);
    const name = await readSkillName(fs, skillDir);
    const provenance: SourceInfo = { type: "zip", path: zipPath };

    return await importFromDirectory(fs, dataRoot, {
      sourceDir: skillDir,
      provenance,
      name,
      ...(options.newSkillId === undefined ? {} : { newSkillId: options.newSkillId }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  } finally {
    // Hapus selalu; kegagalan bersih-bersih tidak menutupi galat utama dan
    // sisa direktori akan dilaporkan doctor (spec §14).
    await fs.remove(tempDir, { recursive: true });
  }
}
