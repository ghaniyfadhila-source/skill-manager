import path from "node:path";
import { describe, expect, it } from "vitest";
import { SkillManagerError } from "../core/errors.js";
import { contentHash } from "../core/hash.js";
import { loadState } from "../core/state.js";
import { MemoryFileSystem } from "../fs/memory.js";
import type { FileSystem, FsResult } from "../fs/types.js";
import { importFolderSkill } from "./import-folder.js";

const ROOT = path.resolve(path.sep, "sm-import");
const DATA_ROOT = path.join(ROOT, "data");
const LIBRARY = path.join(DATA_ROOT, "library");
const FIXED_ID = "sk_01TEST0000000000000000000";
const FIXED_NOW = "2026-11-05T00:00:00.000Z";
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ENTRIES = 1000;

function ok<T>(result: FsResult<T>): T {
  if (!result.ok) {
    throw new Error(`Operasi gagal: ${result.error.code} — ${result.error.message}`);
  }
  return result.value;
}

async function seedFile(
  fs: FileSystem,
  filePath: string,
  data: string | Uint8Array,
): Promise<void> {
  ok(await fs.mkdir(path.dirname(filePath), { recursive: true }));
  ok(await fs.write(filePath, data));
}

async function seedSource(
  fs: FileSystem,
  dir: string,
  frontmatter: string,
  extras: Record<string, string> = {},
): Promise<void> {
  await seedFile(fs, path.join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n# Judul\n\nIsi.\n`);
  for (const [relativePath, content] of Object.entries(extras)) {
    await seedFile(fs, path.join(dir, relativePath), content);
  }
}

function importOptions(sourceDir: string, overrides: { name?: string } = {}) {
  return {
    sourceDir,
    ...overrides,
    newSkillId: () => FIXED_ID,
    now: () => FIXED_NOW,
  };
}

async function caught(run: Promise<unknown>): Promise<SkillManagerError> {
  try {
    await run;
  } catch (error) {
    if (error instanceof SkillManagerError) {
      return error;
    }
    throw error;
  }
  throw new Error("Impor seharusnya ditolak, tetapi berhasil.");
}

describe("importFolderSkill — impor sukses", () => {
  it("menyalin folder ke library, mencatat provenance, dan menyimpan state", async () => {
    const fs = new MemoryFileSystem();
    const source = path.join(ROOT, "src", "brainstorming");
    await seedSource(
      fs,
      source,
      ["name: brainstorming", 'description: "Menemukan sudut pandang"', "license: MIT"].join("\n"),
      { "references/teknik.md": "# Teknik\n" },
    );

    const result = await importFolderSkill(fs, DATA_ROOT, importOptions(source));

    expect(result.warnings).toEqual([]);
    expect(result.skill).toMatchObject({
      id: FIXED_ID,
      name: "brainstorming",
      dirName: "brainstorming",
      source: { type: "folder", path: source },
      license: "MIT",
      importedAt: FIXED_NOW,
    });
    expect(result.skill.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(ok(await fs.readText(path.join(LIBRARY, "brainstorming", "SKILL.md")))).toContain(
      "name: brainstorming",
    );
    expect(
      ok(await fs.readText(path.join(LIBRARY, "brainstorming", "references", "teknik.md"))),
    ).toBe("# Teknik\n");

    const saved = await loadState(fs, DATA_ROOT);
    expect(saved.status).toBe("loaded");
    expect(saved.state.library).toHaveLength(1);
    expect(saved.state.library.at(0)).toEqual(result.skill);
  });

  it("mencatat hash isi Library, bukan hash folder sumber", async () => {
    const fs = new MemoryFileSystem();
    const source = path.join(ROOT, "src", "hash-skill");
    await seedSource(fs, source, "name: hash-skill");

    const result = await importFolderSkill(fs, DATA_ROOT, importOptions(source));

    expect(result.skill.contentHash).toBe(
      ok(await contentHash(fs, path.join(LIBRARY, "hash-skill"))),
    );
  });

  it("memakai generator id bawaan berformat sk_ + ULID bila tidak disuntikkan", async () => {
    const fs = new MemoryFileSystem();
    const source = path.join(ROOT, "src", "id-skill");
    await seedSource(fs, source, "name: id-skill");

    const result = await importFolderSkill(fs, DATA_ROOT, { sourceDir: source });

    expect(result.skill.id).toMatch(/^sk_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(result.skill.importedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });
});

describe("importFolderSkill — validasi sumber", () => {
  it("menolak folder tanpa SKILL.md", async () => {
    const fs = new MemoryFileSystem();
    const source = path.join(ROOT, "src", "tanpa-skill-md");
    await seedFile(fs, path.join(source, "README.md"), "# bukan skill\n");

    const error = await caught(importFolderSkill(fs, DATA_ROOT, importOptions(source)));

    expect(error.code).toBe("skill_md_missing");
    expect(error.message).toContain("SKILL.md");
    expect(await fs.exists(LIBRARY)).toBe(false);
  });

  it("menolak frontmatter yang tidak bisa diparse", async () => {
    const fs = new MemoryFileSystem();
    const source = path.join(ROOT, "src", "rusak");
    await seedFile(fs, path.join(source, "SKILL.md"), "---\nname rusak\n---\n");

    const error = await caught(importFolderSkill(fs, DATA_ROOT, importOptions(source)));

    expect(error.code).toBe("frontmatter_invalid");
    expect(await fs.exists(LIBRARY)).toBe(false);
  });

  it("menolak frontmatter tanpa name", async () => {
    const fs = new MemoryFileSystem();
    const source = path.join(ROOT, "src", "tanpa-nama");
    await seedSource(fs, source, "description: tanpa nama");

    const error = await caught(importFolderSkill(fs, DATA_ROOT, importOptions(source)));

    expect(error.code).toBe("name_missing");
  });

  it("menolak name yang tidak sama dengan nama folder", async () => {
    const fs = new MemoryFileSystem();
    const source = path.join(ROOT, "src", "nama-folder");
    await seedSource(fs, source, "name: nama-lain");

    const error = await caught(importFolderSkill(fs, DATA_ROOT, importOptions(source)));

    expect(error.code).toBe("name_mismatch");
    expect(error.message).toContain("nama-lain");
    expect(error.message).toContain("nama-folder");
  });

  it("menolak name yang tidak aman sebagai nama folder", async () => {
    const fs = new MemoryFileSystem();
    const source = path.join(ROOT, "src", "aman");
    await seedSource(fs, source, "name: ../keluar");

    const error = await caught(importFolderSkill(fs, DATA_ROOT, importOptions(source)));

    expect(error.code).toBe("invalid_name");
  });
});

describe("importFolderSkill — tabrakan nama", () => {
  it("menolak nama yang sudah ada dan menyebut skill yang sudah ada", async () => {
    const fs = new MemoryFileSystem();
    const source = path.join(ROOT, "src", "brainstorming");
    await seedSource(fs, source, "name: brainstorming");
    await importFolderSkill(fs, DATA_ROOT, importOptions(source));

    const error = await caught(importFolderSkill(fs, DATA_ROOT, importOptions(source)));

    expect(error.code).toBe("name_conflict");
    expect(error.message).toContain("brainstorming");
    const saved = await loadState(fs, DATA_ROOT);
    expect(saved.state.library).toHaveLength(1);
  });

  it("tidak menimpa folder library yang sudah ada", async () => {
    const fs = new MemoryFileSystem();
    const source = path.join(ROOT, "src", "lama");
    await seedSource(fs, source, "name: lama", { "catatan.md": "versi lama\n" });
    await importFolderSkill(fs, DATA_ROOT, importOptions(source));

    const changed = path.join(ROOT, "src", "lama-baru");
    await seedSource(fs, changed, "name: lama", { "catatan.md": "versi baru\n" });
    await caught(importFolderSkill(fs, DATA_ROOT, importOptions(changed)));

    expect(ok(await fs.readText(path.join(LIBRARY, "lama", "catatan.md")))).toBe("versi lama\n");
  });
});

describe("importFolderSkill — batas aman", () => {
  it(`menolak folder dengan lebih dari ${MAX_ENTRIES} entri`, async () => {
    const fs = new MemoryFileSystem();
    const source = path.join(ROOT, "src", "banyak-file");
    await seedSource(fs, source, "name: banyak-file");
    for (let index = 0; index < MAX_ENTRIES; index += 1) {
      await seedFile(fs, path.join(source, "berkas", `f${index}.txt`), "x");
    }

    const error = await caught(importFolderSkill(fs, DATA_ROOT, importOptions(source)));

    expect(error.code).toBe("source_too_many_files");
    expect(await fs.exists(path.join(LIBRARY, "banyak-file"))).toBe(false);
  });

  it(`menolak folder yang totalnya melebihi ${MAX_BYTES} byte`, async () => {
    const fs = new MemoryFileSystem();
    const source = path.join(ROOT, "src", "besar");
    await seedSource(fs, source, "name: besar");
    await seedFile(fs, path.join(source, "aset.bin"), new Uint8Array(MAX_BYTES));

    const error = await caught(importFolderSkill(fs, DATA_ROOT, importOptions(source)));

    expect(error.code).toBe("source_too_large");
    expect(await fs.exists(path.join(LIBRARY, "besar"))).toBe(false);
  });
});

describe("importFolderSkill — keamanan", () => {
  it("menolak tautan yang menunjuk keluar folder sumber", async () => {
    const fs = new MemoryFileSystem();
    const source = path.join(ROOT, "src", "berlink");
    const secret = path.join(ROOT, "rahasia", "kunci.txt");
    await seedFile(fs, secret, "rahasia\n");
    await seedSource(fs, source, "name: berlink");
    ok(await fs.symlink(secret, path.join(source, "tautan.txt")));

    const error = await caught(importFolderSkill(fs, DATA_ROOT, importOptions(source)));

    expect(error.code).toBe("unsafe_symlink");
    expect(error.message).toContain("tautan.txt");
    expect(await fs.exists(path.join(LIBRARY, "berlink"))).toBe(false);
    expect(await loadState(fs, DATA_ROOT)).toMatchObject({ status: "missing" });
  });
});

describe("importFolderSkill — frontmatter longgar dan provenance", () => {
  it("menerima field di luar 6 field resmi dengan peringatan", async () => {
    const fs = new MemoryFileSystem();
    const source = path.join(ROOT, "src", "longgar");
    await seedSource(
      fs,
      source,
      [
        "name: longgar",
        "description: punya field tambahan",
        "version: 2.1.0",
        "author: seseorang",
      ].join("\n"),
    );

    const result = await importFolderSkill(fs, DATA_ROOT, importOptions(source));

    expect(result.skill.name).toBe("longgar");
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.join(" ")).toContain("version");
    expect(result.warnings.join(" ")).toContain("author");
  });

  it("mengambil lisensi dari file LICENSE bila frontmatter tidak menyebutnya", async () => {
    const fs = new MemoryFileSystem();
    const source = path.join(ROOT, "src", "berlisensi");
    await seedSource(fs, source, "name: berlisensi", {
      LICENSE: "Apache-2.0\n\nIsi lisensi.\n",
    });

    const result = await importFolderSkill(fs, DATA_ROOT, importOptions(source));

    expect(result.skill.license).toBe("Apache-2.0");
  });

  it("tidak mengisi lisensi bila tidak ada petunjuk apa pun", async () => {
    const fs = new MemoryFileSystem();
    const source = path.join(ROOT, "src", "tanpa-lisensi");
    await seedSource(fs, source, "name: tanpa-lisensi");

    const result = await importFolderSkill(fs, DATA_ROOT, importOptions(source));

    expect(result.skill.license).toBeUndefined();
    expect(Object.hasOwn(result.skill, "license")).toBe(false);
  });
});
