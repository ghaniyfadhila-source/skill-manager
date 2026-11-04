import path from "node:path";
import { describe, expect, it } from "vitest";
import { TEMP_PREFIX, writeDirectoryAtomic, writeFileAtomic } from "./atomic.js";
import { MemoryFileSystem } from "./memory.js";
import { type FileSystem, type FsResult, fsErr } from "./types.js";

const ROOT = path.resolve(path.sep, "sm-atomic");

function ok<T>(result: FsResult<T>): T {
  if (!result.ok) {
    throw new Error(`Operasi gagal: ${result.error.code} — ${result.error.message}`);
  }
  return result.value;
}

class RenameFailingFs extends MemoryFileSystem {
  override async rename(_from: string, to: string): Promise<FsResult<void>> {
    return fsErr("io_error", to, "Rename gagal (disimulasikan).");
  }
}

async function mkdirp(fs: FileSystem, dir: string): Promise<void> {
  ok(await fs.mkdir(dir, { recursive: true }));
}

describe("writeFileAtomic", () => {
  it("menulis file lalu rename tanpa menyisakan .tmp", async () => {
    const fs = new MemoryFileSystem();
    const dir = path.join(ROOT, "file");
    await mkdirp(fs, dir);
    const target = path.join(dir, "state.json");

    ok(await writeFileAtomic(fs, target, '{"schemaVersion":1}'));

    expect(ok(await fs.readText(target))).toBe('{"schemaVersion":1}');
    expect(ok(await fs.readdir(dir)).map((entry) => entry.name)).toEqual(["state.json"]);
  });

  it("membersihkan .tmp dan mempertahankan file lama bila rename gagal", async () => {
    const fs = new RenameFailingFs();
    const dir = path.join(ROOT, "file-gagal");
    await mkdirp(fs, dir);
    const target = path.join(dir, "state.json");
    ok(await fs.write(target, "lama"));

    const result = await writeFileAtomic(fs, target, "baru");

    expect(result).toMatchObject({ ok: false, error: { code: "io_error" } });
    expect(ok(await fs.readText(target))).toBe("lama");
    expect(ok(await fs.readdir(dir)).map((entry) => entry.name)).toEqual(["state.json"]);
  });
});

describe("writeDirectoryAtomic", () => {
  it("mengisi direktori sementara di Store lalu rename ke target", async () => {
    const fs = new MemoryFileSystem();
    const store = path.join(ROOT, "store");
    await mkdirp(fs, store);
    const target = path.join(store, "skill");
    let seenDuringPopulate: string[] = [];

    ok(
      await writeDirectoryAtomic(fs, target, async (tempDir) => {
        seenDuringPopulate = ok(await fs.readdir(store)).map((entry) => entry.name);
        ok(await fs.write(path.join(tempDir, "SKILL.md"), "# skill"));
        return { ok: true, value: undefined };
      }),
    );

    expect(seenDuringPopulate).toHaveLength(1);
    expect(seenDuringPopulate[0]).toMatch(new RegExp(`^\\${TEMP_PREFIX}`));
    expect(ok(await fs.readText(path.join(target, "SKILL.md")))).toBe("# skill");
    expect(ok(await fs.readdir(store)).map((entry) => entry.name)).toEqual(["skill"]);
  });

  it("membersihkan direktori sementara bila populate mengembalikan galat", async () => {
    const fs = new MemoryFileSystem();
    const store = path.join(ROOT, "store-gagal");
    await mkdirp(fs, store);
    const target = path.join(store, "skill");

    const result = await writeDirectoryAtomic(fs, target, async (tempDir) => {
      ok(await fs.write(path.join(tempDir, "sebagian.txt"), "x"));
      return fsErr("io_error", tempDir, "Populate gagal (disimulasikan).");
    });

    expect(result).toMatchObject({ ok: false, error: { code: "io_error" } });
    expect(await fs.exists(target)).toBe(false);
    expect(ok(await fs.readdir(store))).toEqual([]);
  });

  it("membersihkan direktori sementara bila populate melempar error", async () => {
    const fs = new MemoryFileSystem();
    const store = path.join(ROOT, "store-throw");
    await mkdirp(fs, store);
    const target = path.join(store, "skill");

    const result = await writeDirectoryAtomic(fs, target, async () => {
      throw new Error("meledak");
    });

    expect(result).toMatchObject({ ok: false, error: { code: "io_error" } });
    expect(await fs.exists(target)).toBe(false);
    expect(ok(await fs.readdir(store))).toEqual([]);
  });

  it("tidak menimpa target yang sudah ada", async () => {
    const fs = new MemoryFileSystem();
    const store = path.join(ROOT, "store-konflik");
    await mkdirp(fs, path.join(store, "skill"));
    ok(await fs.write(path.join(store, "skill", "lama.txt"), "lama"));

    const result = await writeDirectoryAtomic(fs, path.join(store, "skill"), async (tempDir) => {
      ok(await fs.write(path.join(tempDir, "baru.txt"), "baru"));
      return { ok: true, value: undefined };
    });

    expect(result).toMatchObject({ ok: false, error: { code: "already_exists" } });
    expect(ok(await fs.readText(path.join(store, "skill", "lama.txt")))).toBe("lama");
    expect(ok(await fs.readdir(store))).toEqual([
      { name: "skill", kind: "directory", isSymlink: false },
    ]);
  });
});
