/**
 * Parser frontmatter YAML minimal untuk `SKILL.md`.
 *
 * Sengaja tanpa dependensi YAML: spec §10.2 hanya butuh blok `---` berisi
 * `key: value`, string berkutip, dan satu level `metadata`. Fitur YAML lain
 * (daftar, blok multi-baris, anchor) ditolak sebagai frontmatter tidak valid.
 */
import { SkillManagerError } from "../core/errors.js";

/** Enam field frontmatter resmi; field lain diterima dengan peringatan (spec §10.2). */
export const OFFICIAL_FRONTMATTER_FIELDS = [
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
] as const;

export type OfficialFrontmatterField = (typeof OFFICIAL_FRONTMATTER_FIELDS)[number];

export type FrontmatterValue = string | Readonly<Record<string, string>>;

export interface Frontmatter {
  readonly data: Readonly<Record<string, FrontmatterValue>>;
  /** Isi setelah blok frontmatter, apa adanya. */
  readonly body: string;
}

/** Kode galat stabil untuk frontmatter yang tidak bisa diparse. */
export const FRONTMATTER_INVALID_CODE = "frontmatter_invalid";

const KEY_PATTERN = /^([A-Za-z0-9_-]+)[ \t]*:[ \t]*(.*)$/;
const INDENTED_PATTERN = /^[ \t]+\S/;

function invalid(message: string): SkillManagerError {
  return new SkillManagerError({ code: FRONTMATTER_INVALID_CODE, message });
}

/** Baca satu nilai skalar: string berkutip dilepas kutipnya, sisanya di-trim. */
function parseScalar(raw: string, lineNumber: number): string {
  const value = raw.trim();
  if (value.startsWith('"') || value.startsWith("'")) {
    const quote = value.charAt(0);
    if (value.length < 2 || !value.endsWith(quote)) {
      throw invalid(`baris ${lineNumber}: string berkutip tidak ditutup.`);
    }
    return value.slice(1, -1).replaceAll(`\\${quote}`, quote);
  }
  return value;
}

/**
 * Parse blok frontmatter di awal teks. Blok wajib dibuka dan ditutup `---`.
 *
 * @throws SkillManagerError `frontmatter_invalid` bila blok tidak ada, tidak
 * ditutup, atau berisi baris yang bukan pasangan `key: value`.
 */
export function parseFrontmatter(text: string): Frontmatter {
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
  const start = lines.findIndex((line) => line.trim() !== "");
  if (start === -1 || lines[start]?.trim() !== "---") {
    throw invalid("SKILL.md tidak memiliki blok frontmatter (---) di awal file.");
  }
  const end = lines.findIndex((line, index) => index > start && line.trim() === "---");
  if (end === -1) {
    throw invalid("Blok frontmatter tidak ditutup dengan ---.");
  }

  const data: Record<string, FrontmatterValue> = {};
  let nested: { key: string; map: Record<string, string> } | undefined;

  for (let index = start + 1; index < end; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    const indented = INDENTED_PATTERN.test(line);
    const match = KEY_PATTERN.exec(indented ? trimmed : line);
    if (!match) {
      throw invalid(`baris ${index + 1}: bukan pasangan key: value.`);
    }
    const key = match[1] ?? "";
    const rawValue = match[2] ?? "";

    if (indented) {
      if (!nested) {
        throw invalid(`baris ${index + 1}: baris menjorok tanpa induk key.`);
      }
      nested.map[key] = parseScalar(rawValue, index + 1);
      continue;
    }

    if (rawValue.trim() === "") {
      nested = { key, map: {} };
      data[key] = nested.map;
      continue;
    }
    nested = undefined;
    data[key] = parseScalar(rawValue, index + 1);
  }

  return { data, body: lines.slice(end + 1).join("\n") };
}
