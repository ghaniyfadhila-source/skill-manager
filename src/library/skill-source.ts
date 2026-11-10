/**
 * Penemuan folder skill di dalam sumber yang baru diunduh (git clone / ekstrak
 * zip). Aturan spec §10.2 untuk git: SKILL.md harus ada di root atau di tepat
 * satu subdirektori (kedalaman 1). Aturan yang sama dipakai zip supaya arsip
 * yang membungkus satu folder (mis. `nama-skill/SKILL.md`) tetap bisa diimpor.
 *
 * Hanya membaca metadata; tidak ada kode dari sumber yang dieksekusi.
 */
import path from "node:path";
import { SkillManagerError } from "../core/errors.js";
import { isPathInside } from "../fs/guard.js";
import type { FileSystem } from "../fs/types.js";
import { parseFrontmatter } from "./frontmatter.js";
import { SKILL_FILE_NAME } from "./import-folder.js";

/** Kode galat stabil untuk penemuan folder skill. */
export type SkillSourceErrorCode =
  | "skill_md_missing"
  | "skill_md_ambiguous"
  | "source_unreadable"
  | "frontmatter_invalid"
  | "name_missing"
  | "invalid_subdir";

function sourceError(
  code: SkillSourceErrorCode,
  message: string,
  details?: unknown,
): SkillManagerError {
  return new SkillManagerError({ code, message, ...(details === undefined ? {} : { details }) });
}

/** true bila `dir` berisi SKILL.md berupa file (tautan diikuti saat membaca). */
async function hasSkillFile(fs: FileSystem, dir: string): Promise<boolean> {
  const stat = await fs.stat(path.join(dir, SKILL_FILE_NAME));
  return stat.ok && stat.value.kind === "file";
}

/**
 * Cari folder skill: root menang bila punya SKILL.md, lalu tepat satu
 * subdirektori kedalaman 1. Nol kandidat -> `skill_md_missing`; lebih dari
 * satu -> `skill_md_ambiguous` (tidak menebak).
 */
export async function findSkillDirectory(fs: FileSystem, root: string): Promise<string> {
  if (await hasSkillFile(fs, root)) {
    return root;
  }

  const listing = await fs.readdir(root);
  if (!listing.ok) {
    throw sourceError(
      "source_unreadable",
      `Folder hasil unduhan tidak bisa dibaca: ${root} (${listing.error.code}).`,
      listing.error,
    );
  }

  const candidates: string[] = [];
  for (const entry of listing.value) {
    if (entry.kind !== "directory" || entry.isSymlink) {
      continue;
    }
    const candidate = path.join(root, entry.name);
    if (await hasSkillFile(fs, candidate)) {
      candidates.push(candidate);
    }
  }

  if (candidates.length === 0) {
    throw sourceError(
      "skill_md_missing",
      `Tidak ada ${SKILL_FILE_NAME} di root atau di satu subdirektori sumber impor.`,
    );
  }
  if (candidates.length > 1) {
    const names = candidates.map((candidate) => path.basename(candidate)).join(", ");
    throw sourceError(
      "skill_md_ambiguous",
      `Ditemukan lebih dari satu kandidat skill (${names}); impor membutuhkan tepat satu ${SKILL_FILE_NAME}.`,
      { candidates: names },
    );
  }
  return candidates[0] as string;
}

/**
 * Pilih folder skill: `subdir` eksplisit (satu path relatif di dalam `root`)
 * atau, bila kosong, autodeteksi `findSkillDirectory`. Dipakai katalog untuk
 * menunjuk satu skill di dalam monorepo (mis. `skills/docx`).
 */
export async function resolveSkillDirectory(
  fs: FileSystem,
  root: string,
  subdir?: string,
): Promise<string> {
  if (subdir === undefined || subdir === "") {
    return findSkillDirectory(fs, root);
  }

  const ok =
    !path.isAbsolute(subdir) &&
    !subdir.includes("\\") &&
    !subdir.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
  if (!ok) {
    throw sourceError(
      "invalid_subdir",
      `Subfolder skill tidak valid: "${subdir}". Gunakan satu path relatif di dalam repositori.`,
      { subdir },
    );
  }

  const dir = path.join(root, subdir);
  if (!isPathInside(root, dir)) {
    throw sourceError(
      "invalid_subdir",
      `Subfolder skill menunjuk keluar repositori: "${subdir}".`,
      { subdir },
    );
  }
  if (!(await hasSkillFile(fs, dir))) {
    throw sourceError(
      "skill_md_missing",
      `Subfolder "${subdir}" tidak berisi ${SKILL_FILE_NAME}.`,
      { subdir },
    );
  }
  return dir;
}

/**
 * Baca `name` dari frontmatter SKILL.md tanpa menyalin folder. Dipakai sumber
 * yang folder sementaranya tidak bernama seperti skill (git/zip), lalu nama itu
 * diteruskan ke `importFromDirectory` sebagai nama yang diharapkan.
 */
export async function readSkillName(fs: FileSystem, skillDir: string): Promise<string> {
  const text = await fs.readText(path.join(skillDir, SKILL_FILE_NAME));
  if (!text.ok) {
    throw sourceError(
      "source_unreadable",
      `${SKILL_FILE_NAME} tidak bisa dibaca: ${text.error.message}`,
      text.error,
    );
  }

  const frontmatter = parseFrontmatter(text.value);
  const raw = frontmatter.data.name;
  if (typeof raw !== "string" || raw.trim() === "") {
    throw sourceError(
      "name_missing",
      `Frontmatter ${SKILL_FILE_NAME} tidak memiliki field "name" yang bisa dipakai.`,
    );
  }
  return raw.trim();
}
