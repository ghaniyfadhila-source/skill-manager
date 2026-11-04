import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SkillManagerError } from "../../src/core/errors.js";
import { contentHash } from "../../src/core/hash.js";
import { loadState } from "../../src/core/state.js";
import { NodeFileSystem } from "../../src/fs/node.js";
import type { FsResult } from "../../src/fs/types.js";
import { importFolderSkill } from "../../src/library/import-folder.js";

function ok<T>(result: FsResult<T>): T {
  if (!result.ok) {
    throw new Error(`Operasi gagal: ${result.error.code} — ${result.error.message}`);
  }
  return result.value;
}

/**
 * Tautan file untuk menguji penolakan escape. Di Windows butuh Developer Mode
 * atau privilege; bila OS menolak, test di-skip dengan alasan yang terlihat.
 */
async function createFileLink(target: string, linkPath: string): Promise<boolean> {
  try {
    await symlink(target, linkPath, "file");
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "UNKNOWN";
    if (["EPERM", "EACCES", "ENOSYS", "UNKNOWN", "EINVAL"].includes(code)) {
      console.warn(`[skip] OS menolak pembuatan tautan file (${code}): ${linkPath}`);
      return false;
    }
    throw error;
  }
}

describe("impor folder pada filesystem nyata", () => {
  let base: string;
  let source: string;
  let dataRoot: string;
  const fs = new NodeFileSystem();

  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), "sm-import-"));
    source = path.join(base, "brainstorming");
    dataRoot = path.join(base, "data");
    await mkdir(path.join(source, "references"), { recursive: true });
    await writeFile(
      path.join(source, "SKILL.md"),
      "---\nname: brainstorming\ndescription: Menemukan sudut pandang\nlicense: MIT\n---\n# Brainstorming\n",
    );
    await writeFile(path.join(source, "references", "teknik.md"), "# Teknik\n");
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("menyalin folder, menyimpan state.json, dan mencatat hash isi Library", async () => {
    const result = await importFolderSkill(fs, dataRoot, { sourceDir: source });
    const libraryDir = path.join(dataRoot, "library", "brainstorming");

    expect(result.skill).toMatchObject({
      name: "brainstorming",
      dirName: "brainstorming",
      source: { type: "folder", path: source },
      license: "MIT",
    });
    expect(ok(await fs.readText(path.join(libraryDir, "references", "teknik.md")))).toBe(
      "# Teknik\n",
    );
    expect(result.skill.contentHash).toBe(ok(await contentHash(fs, libraryDir)));

    const raw = JSON.parse(await readFile(path.join(dataRoot, "state.json"), "utf8")) as {
      library: { id: string }[];
    };
    expect(raw.library).toHaveLength(1);
    expect(raw.library[0]?.id).toBe(result.skill.id);
    expect((await loadState(fs, dataRoot)).state.library).toHaveLength(1);
  });

  it("menolak tautan yang menunjuk keluar folder sumber tanpa menyisakan Library", async () => {
    const secret = path.join(base, "rahasia.txt");
    await writeFile(secret, "rahasia\n");
    const linked = await createFileLink(secret, path.join(source, "tautan.txt"));
    if (!linked) {
      return;
    }

    let caught: unknown;
    try {
      await importFolderSkill(fs, dataRoot, { sourceDir: source });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SkillManagerError);
    expect((caught as SkillManagerError).code).toBe("unsafe_symlink");
    expect(await fs.exists(path.join(dataRoot, "library", "brainstorming"))).toBe(false);
    expect(await fs.exists(path.join(dataRoot, "state.json"))).toBe(false);
  });
});
