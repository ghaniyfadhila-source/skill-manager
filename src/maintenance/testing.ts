import path from "node:path";
import { loadAdapters } from "../adapters/loader.js";
import type { Adapter } from "../adapters/manifest.js";
import { SkillManagerError } from "../core/errors.js";
import { contentHash } from "../core/hash.js";
import { libraryRoot } from "../core/paths.js";
import { saveState } from "../core/state.js";
import { type Skill, STATE_SCHEMA_VERSION, type StateFile } from "../core/types.js";
import { MemoryFileSystem } from "../fs/memory.js";
import type { FsResult } from "../fs/types.js";
import { installSkill } from "../install/install.js";

/** Fixture bersama test maintenance (drift, sync, doctor). Tanpa disk asli. */
export const HOME = path.resolve(path.sep, "sm-maint-home");
export const DATA_ROOT = path.resolve(path.sep, "sm-maint-data");
export const LIBRARY = libraryRoot(DATA_ROOT);
export const SKILL_NAME = "brainstorming";
export const SKILL_MD = "# Brainstorming\n";
export const TIPS = "tips\n";

export function ok<T>(result: FsResult<T>): T {
  if (!result.ok) {
    throw new Error(`Operasi gagal: ${result.error.code} — ${result.error.message}`);
  }
  return result.value;
}

export async function captureError(run: () => Promise<unknown>): Promise<SkillManagerError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof SkillManagerError) {
      return error;
    }
    throw error;
  }
  throw new Error("Fungsi seharusnya melempar SkillManagerError");
}

export async function mkdirp(fs: MemoryFileSystem, dir: string): Promise<void> {
  ok(await fs.mkdir(dir, { recursive: true }));
}

export interface Fixture {
  readonly fs: MemoryFileSystem;
  readonly adapters: readonly Adapter[];
  readonly skill: Skill;
}

export async function fixture(options: { readonly fs?: MemoryFileSystem } = {}): Promise<Fixture> {
  const fs = options.fs ?? new MemoryFileSystem();
  const source = path.join(LIBRARY, SKILL_NAME);
  await mkdirp(fs, path.join(source, "references"));
  ok(await fs.write(path.join(source, "SKILL.md"), SKILL_MD));
  ok(await fs.write(path.join(source, "references", "tips.md"), TIPS));
  const skill: Skill = {
    id: "sk_test",
    name: SKILL_NAME,
    dirName: SKILL_NAME,
    contentHash: ok(await contentHash(fs, source)),
    source: { type: "folder", path: path.join(HOME, "asal") },
    importedAt: "2026-11-05T00:00:00Z",
  };
  const state: StateFile = {
    schemaVersion: STATE_SCHEMA_VERSION,
    library: [skill],
    installations: [],
    projects: [],
    settings: { sharedGroupMembers: [] },
  };
  ok(await saveState(fs, DATA_ROOT, state));
  const catalog = await loadAdapters({ fs, dataRoot: DATA_ROOT });
  return { fs, adapters: catalog.adapters, skill };
}

export function storePath(harness: string): string {
  switch (harness) {
    case "claude-code":
      return path.join(HOME, ".claude", "skills");
    case "opencode":
      return path.join(HOME, ".config", "opencode", "skills");
    case "antigravity":
      return path.join(HOME, ".gemini", "config", "skills");
    default:
      return path.join(HOME, ".agents", "skills");
  }
}

export function installedPath(harness: string): string {
  return path.join(storePath(harness), SKILL_NAME);
}

export async function setupSkill(setup: Fixture, targets: readonly string[]): Promise<void> {
  const results = await installSkill({
    fs: setup.fs,
    dataRoot: DATA_ROOT,
    adapters: setup.adapters,
    home: HOME,
    skill: SKILL_NAME,
    targets,
    acknowledgeShared: true,
  });
  for (const result of results) {
    if (!result.ok) {
      throw new Error(`Pasang gagal: ${result.error?.code} — ${result.error?.message}`);
    }
  }
}
