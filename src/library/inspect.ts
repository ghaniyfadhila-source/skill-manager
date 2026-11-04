/**
 * Pratinjau isi sumber impor SEBELUM konfirmasi (spec §13, dipakai UI ticket 10).
 *
 * Hanya membaca: tidak ada kode skill yang dieksekusi, tidak ada berkas yang
 * ditulis. Hasilnya dipakai untuk menampilkan pohon file, ukuran, lisensi, dan
 * penanda risiko (scripts/, binary, tautan keluar folder).
 */
import path from "node:path";
import { SkillManagerError } from "../core/errors.js";
import { isPathInside } from "../fs/guard.js";
import type { FileSystem } from "../fs/types.js";
import { type WalkEntry, walkTree } from "../fs/walk.js";
import { parseFrontmatter } from "./frontmatter.js";
import { MAX_SOURCE_BYTES, MAX_SOURCE_ENTRIES, SKILL_FILE_NAME } from "./import-folder.js";

/** Kode galat stabil pratinjau sumber. */
export type InspectErrorCode =
  | "source_not_found"
  | "source_not_directory"
  | "source_unreadable"
  | "source_too_many_files"
  | "source_too_large";

/** Satu simpul pohon; children hanya ada untuk direktori. */
export interface InspectNode {
  readonly name: string;
  /** Path relatif terhadap akar sumber, pemisah "/". */
  readonly path: string;
  readonly kind: "file" | "directory" | "symlink" | "other";
  readonly size: number;
  readonly children?: readonly InspectNode[];
}

export interface InspectResult {
  readonly files: readonly InspectNode[];
  readonly hasScriptsDir: boolean;
  readonly hasBinary: boolean;
  readonly hasEscapingSymlink: boolean;
  readonly totalBytes: number;
  readonly fileCount: number;
  /** Lisensi dari frontmatter atau baris pertama berkas LICENSE. */
  readonly license?: string;
  /** Peringatan yang bisa ditampilkan ke user sebelum konfirmasi. */
  readonly risks: readonly string[];
}

const LICENSE_FILE_PATTERN = /^licen[cs]e(\.(md|txt))?$/i;

/** Ekstensi yang dianggap berkas biner; cukup untuk penanda risiko di UI. */
const BINARY_EXTENSIONS = new Set([
  "a",
  "bin",
  "class",
  "dll",
  "dylib",
  "exe",
  "gif",
  "gz",
  "ico",
  "jar",
  "jpeg",
  "jpg",
  "mov",
  "mp3",
  "mp4",
  "node",
  "o",
  "otf",
  "pdf",
  "png",
  "so",
  "tar",
  "ttf",
  "wasm",
  "webp",
  "woff",
  "woff2",
  "zip",
  "7z",
]);

function inspectError(
  code: InspectErrorCode,
  message: string,
  details?: unknown,
): SkillManagerError {
  return new SkillManagerError({ code, message, ...(details === undefined ? {} : { details }) });
}

/** Telusuri sumber dengan batas aman yang sama seperti impor folder. */
async function scanSource(fs: FileSystem, sourceDir: string): Promise<readonly WalkEntry[]> {
  const walked = await walkTree(fs, sourceDir, {
    maxEntries: MAX_SOURCE_ENTRIES,
    maxBytes: MAX_SOURCE_BYTES,
  });
  if (walked.ok) {
    return walked.value;
  }
  if (walked.error.code !== "io_error") {
    throw inspectError(
      "source_unreadable",
      `Folder sumber tidak bisa ditelusuri: ${walked.error.message}`,
      walked.error,
    );
  }

  const counted = await walkTree(fs, sourceDir, { maxEntries: MAX_SOURCE_ENTRIES });
  if (!counted.ok) {
    throw inspectError(
      "source_too_many_files",
      `Folder sumber melebihi batas ${MAX_SOURCE_ENTRIES} entri. Impor akan ditolak.`,
    );
  }
  throw inspectError(
    "source_too_large",
    `Ukuran folder sumber melebihi batas ${MAX_SOURCE_BYTES} byte (10 MiB). Impor akan ditolak.`,
  );
}

function buildTree(entries: readonly WalkEntry[]): readonly InspectNode[] {
  const root: InspectNode[] = [];
  const childrenByPath = new Map<string, InspectNode[]>([["", root]]);

  for (const entry of entries) {
    const separator = entry.relativePath.lastIndexOf("/");
    const parentPath = separator === -1 ? "" : entry.relativePath.slice(0, separator);
    const name = separator === -1 ? entry.relativePath : entry.relativePath.slice(separator + 1);
    const children: InspectNode[] | undefined = entry.kind === "directory" ? [] : undefined;
    const node: InspectNode = {
      name,
      path: entry.relativePath,
      // readdir mengikuti tautan, jadi tautan ke file/direktori tetap dilaporkan
      // sebagai symlink agar UI tidak menampilkan targetnya sebagai isi skill.
      kind: entry.isSymlink ? "symlink" : entry.kind,
      size: entry.size,
      ...(children === undefined ? {} : { children }),
    };

    const siblings = childrenByPath.get(parentPath) ?? root;
    siblings.push(node);
    if (children !== undefined) {
      childrenByPath.set(entry.relativePath, children);
    }
  }
  return root;
}

function isBinaryFile(entry: WalkEntry): boolean {
  if (entry.kind !== "file") {
    return false;
  }
  const extension = path.posix.extname(entry.relativePath).slice(1).toLowerCase();
  return BINARY_EXTENSIONS.has(extension);
}

/** Tautan dianggap keluar bila target leksikal atau target kanoniknya di luar akar. */
async function escapesRoot(
  fs: FileSystem,
  rootLexical: string,
  rootReal: string,
  entry: WalkEntry,
): Promise<boolean> {
  const link = await fs.readlink(entry.path);
  if (!link.ok) {
    return true;
  }
  const target = path.resolve(path.dirname(entry.path), link.value);
  if (!isPathInside(rootLexical, target)) {
    return true;
  }
  const real = await fs.realpath(target);
  if (real.ok) {
    return !isPathInside(rootReal, real.value);
  }
  return false;
}

function licenseFromEntries(entries: readonly WalkEntry[]): WalkEntry | undefined {
  return entries.find(
    (entry) =>
      entry.kind === "file" &&
      !entry.isSymlink &&
      !entry.relativePath.includes("/") &&
      LICENSE_FILE_PATTERN.test(entry.relativePath),
  );
}

async function detectLicense(
  fs: FileSystem,
  sourceDir: string,
  entries: readonly WalkEntry[],
): Promise<string | undefined> {
  const skillText = await fs.readText(path.join(sourceDir, SKILL_FILE_NAME));
  if (skillText.ok) {
    try {
      const declared = parseFrontmatter(skillText.value).data.license;
      if (typeof declared === "string" && declared.trim() !== "") {
        return declared.trim();
      }
    } catch {
      // Frontmatter rusak bukan urusan pratinjau; impor yang akan menolaknya.
    }
  }

  const licenseEntry = licenseFromEntries(entries);
  if (licenseEntry === undefined) {
    return undefined;
  }
  const text = await fs.readText(licenseEntry.path);
  if (!text.ok) {
    return undefined;
  }
  const firstLine = text.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== "");
  return firstLine === undefined || firstLine === "" ? undefined : firstLine.slice(0, 200);
}

/**
 * Periksa sumber tanpa mengeksekusi atau menulis apa pun. Galat memakai kode
 * yang sama dengan impor folder agar UI bisa menampilkan penolakan yang sama.
 */
export async function inspectSource(fs: FileSystem, sourceDir: string): Promise<InspectResult> {
  const lexicalRoot = path.resolve(sourceDir);
  const stat = await fs.stat(lexicalRoot);
  if (!stat.ok) {
    throw inspectError(
      "source_not_found",
      `Folder sumber tidak bisa dibaca: ${sourceDir} (${stat.error.code}).`,
      stat.error,
    );
  }
  if (stat.value.kind !== "directory") {
    throw inspectError("source_not_directory", `Sumber impor bukan folder: ${sourceDir}.`);
  }

  const real = await fs.realpath(lexicalRoot);
  const realRoot = real.ok ? real.value : lexicalRoot;
  const entries = await scanSource(fs, lexicalRoot);

  const hasScriptsDir = entries.some(
    (entry) =>
      entry.kind === "directory" &&
      !entry.isSymlink &&
      path.posix.basename(entry.relativePath).toLowerCase() === "scripts",
  );
  const hasBinary = entries.some(isBinaryFile);
  const hasEscapingSymlink = (
    await Promise.all(
      entries
        .filter((entry) => entry.isSymlink)
        .map((entry) => escapesRoot(fs, lexicalRoot, realRoot, entry)),
    )
  ).some(Boolean);

  const fileEntries = entries.filter((entry) => entry.kind === "file" && !entry.isSymlink);
  const totalBytes = fileEntries.reduce((total, entry) => total + entry.size, 0);
  const license = await detectLicense(fs, lexicalRoot, entries);

  const risks: string[] = [];
  if (hasScriptsDir) {
    risks.push(
      "Folder berisi direktori scripts/; isinya tidak dieksekusi saat impor, tetapi periksa sebelum dipakai.",
    );
  }
  if (hasBinary) {
    risks.push("Folder berisi berkas biner; hanya isi teks yang bisa diperiksa otomatis.");
  }
  if (hasEscapingSymlink) {
    risks.push("Ada tautan yang menunjuk keluar folder skill; impor folder akan menolaknya.");
  }

  return {
    files: buildTree(entries),
    hasScriptsDir,
    hasBinary,
    hasEscapingSymlink,
    totalBytes,
    fileCount: fileEntries.length,
    ...(license === undefined ? {} : { license }),
    risks,
  };
}
