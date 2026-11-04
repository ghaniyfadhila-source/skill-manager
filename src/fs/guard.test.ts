import path from "node:path";
import { describe, expect, it } from "vitest";
import { guardStorePath, isPathInside, removeWithinStore } from "./guard.js";
import { MemoryFileSystem } from "./memory.js";
import type { FileSystem, FsResult } from "./types.js";

const ROOT = path.resolve(path.sep, "sm-guard");

function ok<T>(result: FsResult<T>): T {
  if (!result.ok) {
    throw new Error(`Operasi gagal: ${result.error.code} — ${result.error.message}`);
  }
  return result.value;
}

async function seedFile(fs: FileSystem, filePath: string, text: string): Promise<void> {
  ok(await fs.mkdir(path.dirname(filePath), { recursive: true }));
  ok(await fs.write(filePath, text));
}

async function makeStore(fs: MemoryFileSystem): Promise<{ store: string; outside: string }> {
  const store = path.join(ROOT, "store");
  const outside = path.join(ROOT, "luar");
  ok(await fs.mkdir(store, { recursive: true }));
  ok(await fs.mkdir(outside, { recursive: true }));
  await seedFile(fs, path.join(outside, "rahasia.txt"), "rahasia");
  return { store, outside };
}

describe("isPathInside", () => {
  it("membedakan anak sebenarnya dari sibling berprefiks sama", () => {
    expect(isPathInside("/store", "/store/a/b")).toBe(true);
    expect(isPathInside("/store", "/store")).toBe(true);
    expect(isPathInside("/store", "/store-evil")).toBe(false);
    expect(isPathInside("/store", "/store/../luar")).toBe(false);
  });
});

describe("guardStorePath", () => {
  it("menerima path di dalam Store dan mengembalikan realpath", async () => {
    const fs = new MemoryFileSystem();
    const { store } = await makeStore(fs);
    await seedFile(fs, path.join(store, "skill", "SKILL.md"), "# x");

    const guarded = ok(
      await guardStorePath(fs, store, path.join(store, "skill", "SKILL.md"), { mustExist: true }),
    );

    expect(guarded.path).toBe(path.join(store, "skill", "SKILL.md"));
    expect(guarded.realPath).toBe(path.join(store, "skill", "SKILL.md"));
    expect(guarded.symlink).toBe(false);
  });

  it("menolak path relatif dan path yang keluar secara leksikal", async () => {
    const fs = new MemoryFileSystem();
    const { store, outside } = await makeStore(fs);

    expect(await guardStorePath(fs, store, "relatif/skill.md")).toMatchObject({
      ok: false,
      error: { code: "invalid_path" },
    });
    expect(
      await guardStorePath(fs, store, path.join(store, "..", "luar", "rahasia.txt")),
    ).toMatchObject({ ok: false, error: { code: "unsafe_path" } });
    expect(await guardStorePath(fs, store, `${store}-evil`)).toMatchObject({
      ok: false,
      error: { code: "unsafe_path" },
    });
    expect(await guardStorePath(fs, store, outside)).toMatchObject({
      ok: false,
      error: { code: "unsafe_path" },
    });
  });

  it("menolak akses lewat tautan yang menunjuk keluar Store", async () => {
    const fs = new MemoryFileSystem();
    const { store, outside } = await makeStore(fs);
    const link = path.join(store, "tautan");
    ok(await fs.symlink(outside, link));

    expect(
      await guardStorePath(fs, store, path.join(link, "rahasia.txt"), { mustExist: true }),
    ).toMatchObject({ ok: false, error: { code: "unsafe_path" } });
    expect(await guardStorePath(fs, store, link)).toMatchObject({
      ok: false,
      error: { code: "unsafe_path" },
    });
  });

  it("menerima path yang belum ada selama induknya berada di dalam Store", async () => {
    const fs = new MemoryFileSystem();
    const { store } = await makeStore(fs);

    const guarded = ok(await guardStorePath(fs, store, path.join(store, "baru", "SKILL.md")));

    expect(guarded.path).toBe(path.join(store, "baru", "SKILL.md"));
    expect(guarded.realPath).toBe(path.join(store, "baru", "SKILL.md"));
    expect(guarded.symlink).toBe(false);
  });

  it("mustExist menghasilkan not_found, sedangkan tautan menggantung unsafe_symlink", async () => {
    const fs = new MemoryFileSystem();
    const { store } = await makeStore(fs);
    const dangling = path.join(store, "menggantung");
    ok(await fs.symlink(path.join(ROOT, "tidak-ada"), dangling));

    expect(
      await guardStorePath(fs, store, path.join(store, "tidak-ada"), { mustExist: true }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await guardStorePath(fs, store, dangling)).toMatchObject({
      ok: false,
      error: { code: "unsafe_symlink" },
    });
  });

  it("menolak Store yang tidak ada", async () => {
    const fs = new MemoryFileSystem();
    expect(
      await guardStorePath(
        fs,
        path.join(ROOT, "store-hilang"),
        path.join(ROOT, "store-hilang", "x"),
      ),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("removeWithinStore", () => {
  it("menghapus tautan saja tanpa menghapus target di dalam Store", async () => {
    const fs = new MemoryFileSystem();
    const { store } = await makeStore(fs);
    const real = path.join(store, "real");
    const link = path.join(store, "tautan");
    await seedFile(fs, path.join(real, "penting.txt"), "tetap ada");
    ok(await fs.symlink(real, link));

    ok(await removeWithinStore(fs, store, link));

    expect(await fs.exists(link)).toBe(false);
    expect(ok(await fs.readText(path.join(real, "penting.txt")))).toBe("tetap ada");
  });

  it("menolak menghapus Store itu sendiri", async () => {
    const fs = new MemoryFileSystem();
    const { store } = await makeStore(fs);

    expect(await removeWithinStore(fs, store, store)).toMatchObject({
      ok: false,
      error: { code: "invalid_path" },
    });
    expect(await fs.exists(store)).toBe(true);
  });
});
