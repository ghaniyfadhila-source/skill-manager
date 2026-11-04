import path from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "../fs/memory.js";
import type { FsResult } from "../fs/types.js";
import { contentHash } from "./hash.js";

const ROOT = path.resolve(path.sep, "sm-hash");

function ok<T>(result: FsResult<T>): T {
  if (!result.ok) {
    throw new Error(`Operasi gagal: ${result.error.code} — ${result.error.message}`);
  }
  return result.value;
}

interface TreeFile {
  readonly path: string;
  readonly text: string;
  readonly mode?: number;
}

async function seedTree(
  fs: MemoryFileSystem,
  root: string,
  files: readonly TreeFile[],
  emptyDirs: readonly string[] = [],
): Promise<void> {
  ok(await fs.mkdir(root, { recursive: true }));
  for (const file of files) {
    const filePath = path.join(root, file.path);
    ok(await fs.mkdir(path.dirname(filePath), { recursive: true }));
    ok(await fs.write(filePath, file.text, { mode: file.mode }));
  }
  for (const dir of emptyDirs) {
    ok(await fs.mkdir(path.join(root, dir), { recursive: true }));
  }
}

async function hashOf(fs: MemoryFileSystem, root: string): Promise<string> {
  return ok(await contentHash(fs, root));
}

describe("contentHash", () => {
  it("mengembalikan sha256: diikuti 64 hex", async () => {
    const fs = new MemoryFileSystem();
    await seedTree(fs, path.join(ROOT, "format"), [{ path: "a.txt", text: "a" }]);

    expect(await hashOf(fs, path.join(ROOT, "format"))).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("deterministik tanpa peduli urutan penulisan file", async () => {
    const first = new MemoryFileSystem();
    await seedTree(first, path.join(ROOT, "satu"), [
      { path: "a.txt", text: "a" },
      { path: "m.txt", text: "m" },
      { path: "z/n.txt", text: "n" },
    ]);

    const second = new MemoryFileSystem();
    await seedTree(second, path.join(ROOT, "dua"), [
      { path: "z/n.txt", text: "n" },
      { path: "m.txt", text: "m" },
      { path: "a.txt", text: "a" },
    ]);

    expect(await hashOf(first, path.join(ROOT, "satu"))).toBe(
      await hashOf(second, path.join(ROOT, "dua")),
    );
  });

  it("tidak memakai mtime", async () => {
    const fs = new MemoryFileSystem();
    const alpha = path.join(ROOT, "alpha");
    const beta = path.join(ROOT, "beta");
    await seedTree(fs, alpha, [{ path: "a.txt", text: "sama" }]);
    await seedTree(fs, beta, [{ path: "a.txt", text: "sama" }]);
    fs.setMtime(path.join(alpha, "a.txt"), 1_000_000);
    fs.setMtime(path.join(beta, "a.txt"), 9_000_000);

    expect(await hashOf(fs, alpha)).toBe(await hashOf(fs, beta));
  });

  it("berubah bila isi file berubah", async () => {
    const fs = new MemoryFileSystem();
    const alpha = path.join(ROOT, "isi-alpha");
    const beta = path.join(ROOT, "isi-beta");
    await seedTree(fs, alpha, [{ path: "a.txt", text: "halo" }]);
    await seedTree(fs, beta, [{ path: "a.txt", text: "hallo" }]);

    expect(await hashOf(fs, alpha)).not.toBe(await hashOf(fs, beta));
  });

  it("berubah bila bit executable berubah", async () => {
    const fs = new MemoryFileSystem();
    const alpha = path.join(ROOT, "mode-alpha");
    const beta = path.join(ROOT, "mode-beta");
    await seedTree(fs, alpha, [{ path: "run.sh", text: "#!/bin/sh\n", mode: 0o644 }]);
    await seedTree(fs, beta, [{ path: "run.sh", text: "#!/bin/sh\n", mode: 0o755 }]);

    expect(await hashOf(fs, alpha)).not.toBe(await hashOf(fs, beta));
  });

  it("memasukkan direktori kosong ke hash", async () => {
    const fs = new MemoryFileSystem();
    const alpha = path.join(ROOT, "dir-alpha");
    const beta = path.join(ROOT, "dir-beta");
    await seedTree(fs, alpha, [{ path: "a.txt", text: "a" }]);
    await seedTree(fs, beta, [{ path: "a.txt", text: "a" }], ["kosong"]);

    expect(await hashOf(fs, alpha)).not.toBe(await hashOf(fs, beta));
  });

  it("tidak mengikuti tautan: tautan dan file biasa berisi sama tetap berbeda", async () => {
    const fs = new MemoryFileSystem();
    const linked = path.join(ROOT, "linked");
    const regular = path.join(ROOT, "regular");
    await seedTree(fs, linked, [{ path: "asli.txt", text: "isi" }]);
    ok(await fs.symlink(path.join(linked, "asli.txt"), path.join(linked, "alias.txt")));
    await seedTree(fs, regular, [
      { path: "asli.txt", text: "isi" },
      { path: "alias.txt", text: "isi" },
    ]);

    expect(await hashOf(fs, linked)).not.toBe(await hashOf(fs, regular));
  });

  it("mengembalikan not_found untuk akar yang tidak ada dan not_a_directory untuk file", async () => {
    const fs = new MemoryFileSystem();
    const file = path.join(ROOT, "bukan-dir.txt");
    await seedTree(fs, path.join(ROOT, "induk"), [{ path: "x.txt", text: "x" }]);
    fs.write(file, "x");

    expect(await contentHash(fs, path.join(ROOT, "tidak-ada"))).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    expect(await contentHash(fs, file)).toMatchObject({
      ok: false,
      error: { code: "not_a_directory" },
    });
  });
});
