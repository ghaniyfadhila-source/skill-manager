import path from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "./memory.js";
import type { FsResult } from "./types.js";
import { walkTree } from "./walk.js";

const ROOT = path.resolve(path.sep, "sm-walk");

function ok<T>(result: FsResult<T>): T {
  if (!result.ok) {
    throw new Error(`Operasi gagal: ${result.error.code} — ${result.error.message}`);
  }
  return result.value;
}

async function seed(fs: MemoryFileSystem, files: Record<string, string>): Promise<string> {
  const root = path.join(ROOT, "skill");
  ok(await fs.mkdir(root, { recursive: true }));
  for (const [name, text] of Object.entries(files)) {
    const filePath = path.join(root, name);
    ok(await fs.mkdir(path.dirname(filePath), { recursive: true }));
    ok(await fs.write(filePath, text));
  }
  return root;
}

describe("walkTree", () => {
  it("mengembalikan path relatif POSIX dan mengurutkan entri", async () => {
    const fs = new MemoryFileSystem();
    const root = await seed(fs, {
      "SKILL.md": "x",
      "references/b.md": "y",
      "references/a.md": "z",
    });

    const entries = ok(await walkTree(fs, root));
    const relatives = entries.map((entry) => entry.relativePath);

    expect(relatives).toContain("SKILL.md");
    expect(relatives).toContain("references");
    expect(relatives).toContain("references/a.md");
    expect(relatives.every((relative) => !relative.includes("\\"))).toBe(true);
  });

  it("melaporkan ukuran file", async () => {
    const fs = new MemoryFileSystem();
    const root = await seed(fs, { "SKILL.md": "12345" });

    const entries = ok(await walkTree(fs, root));
    const skill = entries.find((entry) => entry.relativePath === "SKILL.md");

    expect(skill?.kind).toBe("file");
    expect(skill?.size).toBe(5);
  });

  it("menolak bila jumlah entri melewati maxEntries", async () => {
    const fs = new MemoryFileSystem();
    const root = await seed(fs, { "a.txt": "a", "b.txt": "b", "c.txt": "c" });

    const result = await walkTree(fs, root, { maxEntries: 2 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("melebihi batas");
    }
  });

  it("menolak bila total byte melewati maxBytes", async () => {
    const fs = new MemoryFileSystem();
    const root = await seed(fs, { "a.txt": "12345", "b.txt": "67890" });

    const result = await walkTree(fs, root, { maxBytes: 6 });

    expect(result.ok).toBe(false);
  });

  it("tidak mengikuti tautan direktori", async () => {
    const fs = new MemoryFileSystem();
    const root = await seed(fs, { "SKILL.md": "x" });
    const luar = path.join(ROOT, "luar");
    ok(await fs.mkdir(luar, { recursive: true }));
    ok(await fs.write(path.join(luar, "rahasia.txt"), "rahasia"));
    ok(await fs.symlink(luar, path.join(root, "tautan"), { type: "dir" }));

    const entries = ok(await walkTree(fs, root));

    expect(entries.map((entry) => entry.relativePath)).not.toContain("tautan/rahasia.txt");
    const tautan = entries.find((entry) => entry.relativePath === "tautan");
    expect(tautan?.isSymlink).toBe(true);
  });

  it("menolak akar yang bukan direktori", async () => {
    const fs = new MemoryFileSystem();
    const root = await seed(fs, { "SKILL.md": "x" });

    const result = await walkTree(fs, path.join(root, "SKILL.md"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_a_directory");
    }
  });
});
