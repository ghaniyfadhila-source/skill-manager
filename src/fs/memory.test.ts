import path from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "./memory.js";
import type { FileSystem, FsResult } from "./types.js";

const ROOT = path.resolve(path.sep, "sm-memory");

function ok<T>(result: FsResult<T>): T {
  if (!result.ok) {
    throw new Error(`Operasi gagal: ${result.error.code} — ${result.error.message}`);
  }
  return result.value;
}

function makeFs(): MemoryFileSystem {
  return new MemoryFileSystem();
}

async function seedFile(fs: FileSystem, filePath: string, text: string): Promise<void> {
  ok(await fs.mkdir(path.dirname(filePath), { recursive: true }));
  ok(await fs.write(filePath, text));
}

describe("MemoryFileSystem — file dan direktori", () => {
  it("menulis, membaca byte/teks, dan melaporkan stat", async () => {
    const fs = makeFs();
    const file = path.join(ROOT, "store", "a.txt");

    await seedFile(fs, file, "halo");

    expect(new TextDecoder().decode(ok(await fs.read(file)))).toBe("halo");
    expect(ok(await fs.readText(file))).toBe("halo");
    expect(ok(await fs.stat(file))).toMatchObject({ kind: "file", size: 4 });
    expect(await fs.exists(file)).toBe(true);
    expect(await fs.exists(path.join(ROOT, "store", "tidak-ada"))).toBe(false);
    expect(ok(await fs.readdir(path.join(ROOT, "store")))).toEqual([
      { name: "a.txt", kind: "file", isSymlink: false },
    ]);
  });

  it("readdir terurut berdasarkan nama dan melaporkan subdirektori", async () => {
    const fs = makeFs();
    const dir = path.join(ROOT, "urut");
    await seedFile(fs, path.join(dir, "b.txt"), "b");
    await seedFile(fs, path.join(dir, "a.txt"), "a");
    ok(await fs.mkdir(path.join(dir, "sub"), { recursive: true }));

    expect(ok(await fs.readdir(dir)).map((entry) => entry.name)).toEqual(["a.txt", "b.txt", "sub"]);
    expect(ok(await fs.readdir(dir)).at(2)).toEqual({
      name: "sub",
      kind: "directory",
      isSymlink: false,
    });
  });

  it("mkdir rekursif membuat induk, sedangkan write tanpa induk gagal not_found", async () => {
    const fs = makeFs();
    const nested = path.join(ROOT, "a", "b", "c");

    const missingParent = await fs.write(path.join(nested, "x.txt"), "x");
    expect(missingParent).toMatchObject({ ok: false, error: { code: "not_found" } });

    ok(await fs.mkdir(nested, { recursive: true }));
    expect(ok(await fs.stat(nested))).toMatchObject({ kind: "directory" });
    ok(await fs.write(path.join(nested, "x.txt"), "x"));
    expect(ok(await fs.readText(path.join(nested, "x.txt")))).toBe("x");
  });

  it("menolak write ke direktori dan readText untuk byte bukan UTF-8", async () => {
    const fs = makeFs();
    const dir = path.join(ROOT, "direktori");
    ok(await fs.mkdir(dir, { recursive: true }));

    expect(await fs.write(dir, "x")).toMatchObject({
      ok: false,
      error: { code: "is_a_directory" },
    });

    const binary = path.join(dir, "biner.dat");
    ok(await fs.write(binary, new Uint8Array([0xff, 0xfe])));
    expect(await fs.readText(binary)).toMatchObject({
      ok: false,
      error: { code: "invalid_utf8" },
    });
  });
});

describe("MemoryFileSystem — tautan", () => {
  it("realpath, stat, dan readdir mengikuti tautan direktori", async () => {
    const fs = makeFs();
    const target = path.join(ROOT, "target");
    const link = path.join(ROOT, "store", "tautan");
    await seedFile(fs, path.join(target, "isi.txt"), "isi");
    ok(await fs.mkdir(path.join(ROOT, "store"), { recursive: true }));
    ok(await fs.symlink(target, link));

    expect(ok(await fs.lstat(link))).toMatchObject({ kind: "symlink" });
    expect(ok(await fs.stat(link))).toMatchObject({ kind: "directory" });
    expect(ok(await fs.realpath(link))).toBe(ok(await fs.realpath(target)));
    expect(ok(await fs.readdir(path.join(ROOT, "store")))).toEqual([
      { name: "tautan", kind: "directory", isSymlink: true },
    ]);
    expect(ok(await fs.readText(path.join(link, "isi.txt")))).toBe("isi");
  });

  it("tautan menggantung: lstat berhasil, stat ENOENT, exists true", async () => {
    const fs = makeFs();
    const link = path.join(ROOT, "store", "menggantung");
    const missing = path.join(ROOT, "tidak-ada");
    await seedFile(fs, path.join(ROOT, "store", "placeholder.txt"), "x");
    ok(await fs.symlink(missing, link));

    expect(await fs.exists(link)).toBe(true);
    expect(ok(await fs.lstat(link))).toMatchObject({ kind: "symlink" });
    expect(await fs.stat(link)).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await fs.realpath(link)).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(ok(await fs.readlink(link))).toBe(missing);
    expect(ok(await fs.readdir(path.join(ROOT, "store")))).toContainEqual({
      name: "menggantung",
      kind: "dangling",
      isSymlink: true,
    });
  });

  it("remove rekursif hanya menghapus tautan, bukan target di luar pohon", async () => {
    const fs = makeFs();
    const target = path.join(ROOT, "target-luar");
    const store = path.join(ROOT, "store-hapus");
    await seedFile(fs, path.join(target, "penting.txt"), "jangan dihapus");
    ok(await fs.mkdir(store, { recursive: true }));
    ok(await fs.symlink(target, path.join(store, "tautan")));

    ok(await fs.remove(store, { recursive: true }));

    expect(await fs.exists(store)).toBe(false);
    expect(ok(await fs.readText(path.join(target, "penting.txt")))).toBe("jangan dihapus");
  });

  it("remove direktori tidak kosong tanpa recursive menghasilkan not_empty", async () => {
    const fs = makeFs();
    const dir = path.join(ROOT, "tidak-kosong");
    await seedFile(fs, path.join(dir, "a.txt"), "a");

    expect(await fs.remove(dir)).toMatchObject({ ok: false, error: { code: "not_empty" } });
    expect(await fs.exists(dir)).toBe(true);
  });
});

describe("MemoryFileSystem — copy dan rename", () => {
  it("copy mendereference tautan internal dan menolak tautan keluar sumber", async () => {
    const fs = makeFs();
    const source = path.join(ROOT, "sumber");
    const dest = path.join(ROOT, "salinan");
    const outside = path.join(ROOT, "luar.txt");
    await seedFile(fs, path.join(source, "asli.txt"), "asli");
    ok(await fs.symlink(path.join(source, "asli.txt"), path.join(source, "internal.txt")));
    await seedFile(fs, outside, "luar");

    ok(await fs.copy(source, dest));
    expect(ok(await fs.readText(path.join(dest, "internal.txt")))).toBe("asli");
    expect(ok(await fs.lstat(path.join(dest, "internal.txt")))).toMatchObject({ kind: "file" });

    ok(await fs.symlink(outside, path.join(source, "keluar.txt")));
    const escaped = await fs.copy(source, path.join(ROOT, "salinan-dua"));
    expect(escaped).toMatchObject({ ok: false, error: { code: "unsafe_symlink" } });
  });

  it("copy menolak destination yang sudah ada", async () => {
    const fs = makeFs();
    const source = path.join(ROOT, "sumber-dest");
    const dest = path.join(ROOT, "dest");
    await seedFile(fs, path.join(source, "a.txt"), "a");
    ok(await fs.mkdir(dest, { recursive: true }));

    expect(await fs.copy(source, dest)).toMatchObject({
      ok: false,
      error: { code: "already_exists" },
    });
  });

  it("rename mengganti file tujuan dan menolak induk yang hilang", async () => {
    const fs = makeFs();
    const a = path.join(ROOT, "rename", "a.txt");
    const b = path.join(ROOT, "rename", "b.txt");
    await seedFile(fs, a, "isi-a");
    ok(await fs.write(b, "isi-b"));

    ok(await fs.rename(a, b));
    expect(ok(await fs.readText(b))).toBe("isi-a");
    expect(await fs.exists(a)).toBe(false);

    expect(await fs.rename(b, path.join(ROOT, "tidak-ada", "c.txt"))).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });
});
