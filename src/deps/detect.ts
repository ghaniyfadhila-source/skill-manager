import path from "node:path";
import { depsRoot } from "../core/paths.js";
import type { DepCommand, DepKind } from "../core/types.js";
import { type FileSystem, type FsResult, fsErr, fsOk } from "../fs/types.js";

/** Nama manifest yang dikenali (spec §10.6 poin 1). */
const PACKAGE_JSON = "package.json";
const REQUIREMENTS_TXT = "requirements.txt";
const PYPROJECT_TOML = "pyproject.toml";
const SKILL_MD = "SKILL.md";

/** Flag keamanan default npm (spec §10.6 poin 4). */
export const IGNORE_SCRIPTS_FLAG = "--ignore-scripts";

/** Argumen uv untuk requirements.txt dan pyproject.toml. */
export const UV_REQUIREMENTS_ARGS = ["pip", "install", "-r", REQUIREMENTS_TXT] as const;
export const UV_PYPROJECT_ARGS = ["pip", "install", "-r", PYPROJECT_TOML] as const;

export interface DetectDependenciesOptions {
  readonly dataRoot: string;
  /** Nama folder skill di Library, dipakai sebagai nama direktori deps. */
  readonly skillId: string;
  readonly platform?: NodeJS.Platform;
}

interface ManifestRead {
  readonly text: string;
  readonly filePath: string;
}

function validateSkillId(skillId: string): string | undefined {
  if (skillId.length === 0) {
    return "skillId kosong.";
  }
  if (skillId === "." || skillId === ".." || /[\\/]/.test(skillId)) {
    return "skillId tidak boleh berisi pemisah path atau menunjuk ke direktori induk.";
  }
  return undefined;
}

async function readManifest(
  fs: FileSystem,
  directory: string,
  name: string,
): Promise<FsResult<ManifestRead | undefined>> {
  const filePath = path.join(directory, name);
  const stat = await fs.stat(filePath);
  if (!stat.ok || stat.value.kind !== "file") {
    return fsOk(undefined);
  }
  const text = await fs.readText(filePath);
  return text.ok ? fsOk({ text: text.value, filePath }) : text;
}

function splitList(value: string): string[] {
  return value
    .replace(/^\[|\]$/g, "")
    .split(/[,\s]+/)
    .map((token) => token.trim().replace(/^["']|["']$/g, ""))
    .filter((token) => token.length > 0);
}

/**
 * SEMENTARA: ticket 04 belum menyediakan parser frontmatter kanonik di branch
 * ini. Parser minimal ini hanya membaca `metadata.requires`; ganti dengan
 * parser ticket 04 begitu tersedia.
 */
function metadataRequires(text: string): string[] {
  const body = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
  if (!body) {
    return [];
  }
  let inMetadata = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^[A-Za-z0-9_-]+\s*:/.test(line)) {
      inMetadata = /^metadata\s*:/.test(line);
      continue;
    }
    const requires = /^\s+requires\s*:\s*(.+)$/.exec(line);
    if (inMetadata && requires?.[1]) {
      return splitList(requires[1]);
    }
  }
  return [];
}

function hintKinds(tokens: readonly string[]): Set<DepKind> {
  const kinds = new Set<DepKind>();
  for (const token of tokens) {
    const hint = token.toLowerCase();
    if (hint === "npm" || hint === "node" || hint.startsWith("npm:")) {
      kinds.add("npm");
    }
    if (hint === "uv" || hint === "pip" || hint === "python" || hint.startsWith("pip:")) {
      kinds.add("uv");
    }
  }
  return kinds;
}

function withHint(reason: string, kind: DepKind, hints: ReadonlySet<DepKind>): string {
  return hints.has(kind) ? `${reason}; metadata.requires menyebut ${kind}` : reason;
}

function dependencyNames(value: unknown): string[] {
  return typeof value === "object" && value !== null ? Object.keys(value) : [];
}

function parsePackageJson(
  manifest: ManifestRead,
): FsResult<{ readonly dependencies: readonly string[] }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifest.text);
  } catch {
    return fsErr("io_error", manifest.filePath, "package.json bukan JSON yang valid.");
  }
  if (typeof parsed !== "object" || parsed === null) {
    return fsErr("io_error", manifest.filePath, "package.json harus berupa objek JSON.");
  }
  const record = parsed as Record<string, unknown>;
  return fsOk({
    dependencies: [
      ...dependencyNames(record.dependencies),
      ...dependencyNames(record.devDependencies),
    ],
  });
}

/** Nama paket dari requirements.txt; opsi dan komentar diabaikan (hanya tampilan). */
function requirementNames(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("-"))
    .map((line) => line.split(/\s+/)[0] ?? "")
    .filter((name) => name.length > 0);
}

/**
 * Deteksi dependensi dari isi direktori skill (spec §10.6 poin 1).
 *
 * Hasilnya adalah rencana perintah yang belum dijalankan: package.json -> npm
 * dengan `--ignore-scripts` default, requirements.txt/pyproject.toml -> uv.
 * `metadata.requires` hanya memperkaya alasan, tidak pernah membuat perintah
 * sendiri (tanpa manifest tidak ada yang bisa dipasang).
 */
export async function detectDependencies(
  fs: FileSystem,
  skillDir: string,
  options: DetectDependenciesOptions,
): Promise<FsResult<readonly DepCommand[]>> {
  const invalid = validateSkillId(options.skillId);
  if (invalid) {
    return fsErr("invalid_path", options.skillId, invalid);
  }
  const cwd = path.join(depsRoot(options.dataRoot, options.platform), options.skillId);

  const hints = new Set<DepKind>();
  const skillFile = await readManifest(fs, skillDir, SKILL_MD);
  if (skillFile.ok && skillFile.value) {
    for (const kind of hintKinds(metadataRequires(skillFile.value.text))) {
      hints.add(kind);
    }
  }

  const commands: DepCommand[] = [];

  const packageFile = await readManifest(fs, skillDir, PACKAGE_JSON);
  if (!packageFile.ok) {
    return packageFile;
  }
  if (packageFile.value) {
    const manifest = parsePackageJson(packageFile.value);
    if (!manifest.ok) {
      return manifest;
    }
    commands.push({
      kind: "npm",
      command: "npm",
      args: ["install", IGNORE_SCRIPTS_FLAG],
      cwd,
      reason: withHint(
        `package.json: ${manifest.value.dependencies.length} dependensi`,
        "npm",
        hints,
      ),
      dependencies: manifest.value.dependencies,
    });
  }

  const requirements = await readManifest(fs, skillDir, REQUIREMENTS_TXT);
  if (!requirements.ok) {
    return requirements;
  }
  if (requirements.value) {
    const dependencies = requirementNames(requirements.value.text);
    commands.push({
      kind: "uv",
      command: "uv",
      args: [...UV_REQUIREMENTS_ARGS],
      cwd,
      reason: withHint(`requirements.txt: ${dependencies.length} dependensi`, "uv", hints),
      dependencies,
    });
    return fsOk(commands);
  }

  const pyproject = await readManifest(fs, skillDir, PYPROJECT_TOML);
  if (!pyproject.ok) {
    return pyproject;
  }
  if (pyproject.value && /^\s*\[(project|tool\.poetry)\]/m.test(pyproject.value.text)) {
    commands.push({
      kind: "uv",
      command: "uv",
      args: [...UV_PYPROJECT_ARGS],
      cwd,
      reason: withHint("pyproject.toml: proyek Python terdeteksi", "uv", hints),
      dependencies: [],
    });
  }

  return fsOk(commands);
}
