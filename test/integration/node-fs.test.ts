import { chmod, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contentHash } from "../../src/core/hash.js";
import { emptyState, loadState, saveState } from "../../src/core/state.js";
import type { StateFile } from "../../src/core/types.js";
import { writeDirectoryAtomic, writeFileAtomic } from "../../src/fs/atomic.js";
import { guardStorePath, removeWithinStore } from "../../src/fs/guard.js";
import { NodeFileSystem } from "../../src/fs/node.js";
import { type FsResult, isExecutable } from "../../src/fs/types.js";

function ok<T>(result: FsResult<T>): T {
  if (!result.ok) {
    throw new Error(`Operasi gagal: ${result.error.code} — ${result.error.message}`);
  }
  return result.value;
}

/**
 * Membuat tautan direktori: junction di Windows (tidak butuh privilege) dan
 * symlink biasa di Linux. Mengembalikan false bila OS menolak, agar test bisa
 * di-skip dengan alasan yang terlihat di laporan.
 */
async function createDirectoryLink(target: string, linkPath: string): Promise<boolean> {
  try {
    await symlink(target, linkPath, process.platform === "win32" ? "junction" : "dir");
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "UNKNOWN";
    if (["EPERM", "EACCES", "ENOSYS", "UNKNOWN", "EINVAL"].includes(code)) {
      console.warn(`[skip] OS menolak pembuatan tautan direktori (${code}): ${linkPath}`);
      return false;
    }
    throw error;
  }
}

describe("NodeFileSystem", () => {
  let base: string;
  let fs: NodeFileSystem;

  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), "sm-node-fs-"));
    fs = new NodeFileSystem();
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("menulis, membaca, rename, dan readdir terurut", async () => {
    const store = path.join(base, "store");
    ok(await fs.mkdir(store, { recursive: true }));
    ok(await fs.write(path.join(store, "b.txt"), "b"));
    ok(await fs.write(path.join(store, "a.txt"), "a"));

    expect(ok(await fs.readText(path.join(store, "a.txt")))).toBe("a");
    expect(ok(await fs.readdir(store)).map((entry) => entry.name)).toEqual(["a.txt", "b.txt"]);
    expect(ok(await fs.stat(path.join(store, "a.txt")))).toMatchObject({ kind: "file", size: 1 });

    ok(await fs.rename(path.join(store, "a.txt"), path.join(store, "c.txt")));
    expect(await fs.exists(path.join(store, "a.txt"))).toBe(false);
    expect(ok(await fs.readText(path.join(store, "c.txt")))).toBe("a");
  });

  it("readText menolak byte yang bukan UTF-8", async () => {
    const file = path.join(base, "biner.dat");
    ok(await fs.write(file, new Uint8Array([0xff, 0xfe])));

    expect(await fs.readText(file)).toMatchObject({
      ok: false,
      error: { code: "invalid_utf8" },
    });
  });

  it("copy menyalin pohon dan mempertahankan bit executable", async () => {
    const source = path.join(base, "sumber");
    const destination = path.join(base, "tujuan");
    await mkdir(path.join(source, "scripts"), { recursive: true });
    await writeFile(path.join(source, "SKILL.md"), "# Skill\n");
    await writeFile(path.join(source, "scripts", "run.sh"), "#!/bin/sh\n");
    if (process.platform !== "win32") {
      await chmod(path.join(source, "scripts", "run.sh"), 0o755);
    }

    ok(await fs.copy(source, destination));

    expect(await readFile(path.join(destination, "SKILL.md"), "utf8")).toBe("# Skill\n");
    expect(await readFile(path.join(destination, "scripts", "run.sh"), "utf8")).toBe("#!/bin/sh\n");
    if (process.platform !== "win32") {
      expect(isExecutable(ok(await fs.stat(path.join(destination, "scripts", "run.sh"))))).toBe(
        true,
      );
    }
  });

  it("remove rekursif hanya menghapus tautan, bukan target di luar Store", async (ctx) => {
    const target = path.join(base, "target-luar");
    const store = path.join(base, "store-hapus");
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, "penting.txt"), "jangan dihapus");
    await mkdir(store, { recursive: true });
    if (!(await createDirectoryLink(target, path.join(store, "tautan")))) {
      ctx.skip("OS tidak mengizinkan pembuatan tautan direktori untuk test ini");
      return;
    }

    ok(await fs.remove(store, { recursive: true }));

    expect(await fs.exists(store)).toBe(false);
    expect(await readFile(path.join(target, "penting.txt"), "utf8")).toBe("jangan dihapus");
  });

  it("readdir melaporkan junction sebagai direktori dan tautan menggantung", async (ctx) => {
    const target = path.join(base, "target");
    const store = path.join(base, "store");
    const link = path.join(store, "tautan");
    const dangling = path.join(store, "menggantung");
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, "isi.txt"), "isi");
    await mkdir(store, { recursive: true });
    if (!(await createDirectoryLink(target, link))) {
      ctx.skip("OS tidak mengizinkan pembuatan tautan direktori untuk test ini");
      return;
    }
    if (!(await createDirectoryLink(path.join(base, "tidak-ada"), dangling))) {
      ctx.skip("OS tidak mengizinkan pembuatan tautan menggantung");
      return;
    }

    const entries = ok(await fs.readdir(store));
    expect(entries).toEqual([
      { name: "menggantung", kind: "dangling", isSymlink: true },
      { name: "tautan", kind: "directory", isSymlink: true },
    ]);

    expect(ok(await fs.lstat(link))).toMatchObject({ kind: "symlink" });
    expect(ok(await fs.stat(link))).toMatchObject({ kind: "directory" });
    expect(ok(await fs.realpath(link))).toBe(ok(await fs.realpath(target)));
    expect(await fs.readText(path.join(link, "isi.txt"))).toMatchObject({ ok: true });

    expect(await fs.exists(dangling)).toBe(true);
    expect(await fs.stat(dangling)).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await fs.realpath(dangling)).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(ok(await fs.readlink(dangling))).toBe(path.join(base, "tidak-ada"));
  });
  it("contentHash mengabaikan mtime tetapi peka terhadap isi", async () => {
    const alpha = path.join(base, "hash-alpha");
    const beta = path.join(base, "hash-beta");
    for (const dir of [alpha, beta]) {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "SKILL.md"), "# isi yang sama\n");
    }

    const alphaHash = ok(await contentHash(fs, alpha));
    expect(ok(await contentHash(fs, beta))).toBe(alphaHash);

    await utimes(
      path.join(beta, "SKILL.md"),
      new Date("2020-01-01T00:00:00Z"),
      new Date("2020-01-01T00:00:00Z"),
    );
    expect(ok(await contentHash(fs, beta))).toBe(alphaHash);

    await writeFile(path.join(beta, "SKILL.md"), "# isi berbeda\n");
    expect(ok(await contentHash(fs, beta))).not.toBe(alphaHash);
  });

  it("guard menolak operasi lewat junction yang keluar Store", async (ctx) => {
    const store = path.join(base, "guard-store");
    const outside = path.join(base, "guard-luar");
    const link = path.join(store, "tautan");
    await mkdir(store, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, "rahasia.txt"), "rahasia");
    if (!(await createDirectoryLink(outside, link))) {
      ctx.skip("OS tidak mengizinkan pembuatan tautan direktori untuk test ini");
      return;
    }

    expect(
      await guardStorePath(fs, store, path.join(link, "rahasia.txt"), { mustExist: true }),
    ).toMatchObject({ ok: false, error: { code: "unsafe_path" } });
    expect(await guardStorePath(fs, store, path.join(link, "baru.txt"))).toMatchObject({
      ok: false,
      error: { code: "unsafe_path" },
    });
    expect(await removeWithinStore(fs, store, path.join(link, "rahasia.txt"))).toMatchObject({
      ok: false,
      error: { code: "unsafe_path" },
    });
    expect(await readFile(path.join(outside, "rahasia.txt"), "utf8")).toBe("rahasia");
  });
  it("writeFileAtomic mengganti file yang sudah ada tanpa menyisakan .tmp", async () => {
    const dir = path.join(base, "atomic");
    const target = path.join(dir, "state.json");
    ok(await fs.mkdir(dir, { recursive: true }));
    ok(await fs.write(target, "lama"));

    ok(await writeFileAtomic(fs, target, "baru"));

    expect(await readFile(target, "utf8")).toBe("baru");
    expect(ok(await fs.readdir(dir)).map((entry) => entry.name)).toEqual(["state.json"]);
  });

  it("writeDirectoryAtomic mengisi Store dan tidak menimpa target", async () => {
    const store = path.join(base, "atomic-store");
    const target = path.join(store, "skill");
    ok(await fs.mkdir(store, { recursive: true }));

    ok(
      await writeDirectoryAtomic(fs, target, async (tempDir) => {
        ok(await fs.write(path.join(tempDir, "SKILL.md"), "# skill"));
        return { ok: true, value: undefined };
      }),
    );

    expect(await readFile(path.join(target, "SKILL.md"), "utf8")).toBe("# skill");
    expect(ok(await fs.readdir(store)).map((entry) => entry.name)).toEqual(["skill"]);
    expect(
      await writeDirectoryAtomic(fs, target, async () => ({ ok: true, value: undefined })),
    ).toMatchObject({ ok: false, error: { code: "already_exists" } });
  });

  it("saveState/loadState bekerja di disk nyata dan menulis ulang secara atomik", async () => {
    const dataRoot = path.join(base, "data-state");
    ok(await saveState(fs, dataRoot, emptyState()));

    const withSkill: StateFile = {
      ...emptyState(),
      library: [
        {
          id: "sk_1",
          name: "skill",
          dirName: "skill",
          contentHash: `sha256:${"b".repeat(64)}`,
          source: { type: "folder", path: base },
          importedAt: "2026-11-05T00:00:00Z",
        },
      ],
    };
    ok(await saveState(fs, dataRoot, withSkill));

    const loaded = await loadState(fs, dataRoot);
    expect(loaded.status).toBe("loaded");
    expect(loaded.state.library).toEqual(withSkill.library);
    expect(ok(await fs.readdir(dataRoot)).map((entry) => entry.name)).toEqual(["state.json"]);
  });
  it("copy menolak tautan yang menunjuk keluar folder sumber", async (ctx) => {
    const source = path.join(base, "copy-sumber");
    const outside = path.join(base, "copy-luar");
    await mkdir(source, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(source, "SKILL.md"), "# skill\n");
    await writeFile(path.join(outside, "rahasia.txt"), "rahasia");
    if (!(await createDirectoryLink(outside, path.join(source, "keluar")))) {
      ctx.skip("OS tidak mengizinkan pembuatan tautan direktori untuk test ini");
      return;
    }

    expect(await fs.copy(source, path.join(base, "copy-tujuan"))).toMatchObject({
      ok: false,
      error: { code: "unsafe_symlink" },
    });
  });
});
