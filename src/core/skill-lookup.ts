import path from "node:path";
import type { FileSystem } from "../fs/types.js";
import { SkillManagerError } from "./errors.js";
import { libraryRoot } from "./paths.js";
import { loadState } from "./state.js";
import type { Skill, StateFile } from "./types.js";

/**
 * Cari skill di Library berdasarkan nama logis atau id.
 *
 * Dua tingkat dipisahkan dengan sengaja:
 * - `findLibrarySkill` hanya memastikan skill TERCATAT. Cukup untuk mencabut,
 *   yang hanya butuh Hash dan nama folder dan tetap harus berhasil walau isi
 *   Library sudah dihapus manual.
 * - `resolveLibrarySkill` juga memastikan isinya ADA. Wajib untuk memasang,
 *   mengimpor ulang, atau menampilkan detail, yang akan gagal tanpa isi.
 *
 * Menggabungkan keduanya pernah membuat tiga salinan dengan perilaku berbeda;
 * satu salinan yang lebih longgar akan membuat pemasangan gagal dengan galat
 * filesystem mentah alih-alih `skill_not_found` yang bisa ditampilkan.
 */
export async function findLibrarySkill(
  fs: FileSystem,
  dataRoot: string,
  name: string,
): Promise<{ skill: Skill; state: StateFile }> {
  const { state } = await loadState(fs, dataRoot);
  const skill = state.library.find((entry) => entry.name === name || entry.id === name);
  if (skill === undefined) {
    throw new SkillManagerError({
      code: "skill_not_found",
      message: `Skill "${name}" tidak ada di Library.`,
    });
  }
  return { skill, state };
}

/** Seperti `findLibrarySkill`, tetapi folder isi skill wajib ada di Library. */
export async function resolveLibrarySkill(
  fs: FileSystem,
  dataRoot: string,
  name: string,
): Promise<{ skill: Skill; source: string; state: StateFile }> {
  const { skill, state } = await findLibrarySkill(fs, dataRoot, name);
  const source = path.join(libraryRoot(dataRoot), skill.dirName);
  const stat = await fs.stat(source);
  if (!stat.ok || stat.value.kind !== "directory") {
    throw new SkillManagerError({
      code: "skill_not_found",
      message: `Isi skill "${skill.name}" tidak ditemukan di Library (${source}).`,
      details: { path: source },
    });
  }
  return { skill, source, state };
}
