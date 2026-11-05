import path from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { SkillManagerError } from "../core/errors.js";
import { loadState } from "../core/state.js";
import { MemoryFileSystem } from "../fs/memory.js";
import type { FileSystem, FsResult, WriteOptions } from "../fs/types.js";
import { importZipSkill } from "./import-zip.js";

const ROOT = path.resolve(path.sep, "sm-zip");
const DATA_ROOT = path.join(ROOT, "data");
const TEMP_ROOT = path.join(ROOT, "tmp");
const UNZIP = path.join(TEMP_ROOT, "unzip");
const ZIP_PATH = path.join(ROOT, "arsip.zip");
const FIXED_ID = "sk_01TEST0000000000000000000";
const FIXED_NOW = "2026-11-05T00:00:00.000Z";

interface ZipSeed {
  readonly name: string;
  readonly data?: string | Uint8Array;
  /** Bit mode Unix lengkap (tipe + izin), mis. 0o120777 untuk symlink. */
  readonly mode?: number;
  /** true = metode stored, false = deflate. */
  readonly stored?: boolean;
}

/** Penulis zip minimal untuk test: local header + central directory + EOCD. */
function makeZip(seeds: readonly ZipSeed[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const seed of seeds) {
    const name = Buffer.from(seed.name, "utf8");
    const data = Buffer.from(seed.data ?? new Uint8Array());
    const method = seed.stored === true ? 0 : 8;
    const compressed = method === 0 ? data : deflateRawSync(data);
    const mode = seed.mode ?? (seed.name.endsWith("/") ? 0o040755 : 0o100644);
    const flags = 0x800;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE((3 << 8) | 20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(flags, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(crc32(data), 16);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE((mode << 16) >>> 0, 38);
    entry.writeUInt32LE(offset, 42);

    parts.push(local, name, compressed);
    central.push(entry, name);
    offset += 30 + name.length + compressed.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(seeds.length, 8);
  end.writeUInt16LE(seeds.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return new Uint8Array(Buffer.concat([...parts, directory, end]));
}

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

function skillMd(frontmatter: string): string {
  return `---\n${frontmatter}\n---\n# Judul\n`;
}

function importOptions() {
  return {
    zipPath: ZIP_PATH,
    tempRoot: TEMP_ROOT,
    newTempDirName: () => "unzip",
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

/** FileSystem yang mencatat setiap penulisan agar test bisa membuktikan penolakan sebelum ekstrak. */
class RecordingFileSystem extends MemoryFileSystem {
  readonly writes: string[] = [];

  override async write(
    targetPath: string,
    data: Uint8Array | string,
    options?: WriteOptions,
  ): Promise<FsResult<void>> {
    this.writes.push(path.resolve(targetPath));
    return super.write(targetPath, data, options);
  }
}

describe("importZipSkill — entri berbahaya ditolak sebelum ekstrak", () => {
  it("menolak entri dengan .., path absolut, dan pemisah Windows tanpa menulis apa pun", async () => {
    const dangerous = ["../evil.sh", "a/../../evil.sh", "/etc/passwd", "C:\\Windows\\win.ini"];

    for (const name of dangerous) {
      const fs = new RecordingFileSystem();
      // SKILL.md valid lebih dulu: membuktikan SELURUH arsip divalidasi sebelum
      // satu entri pun diekstrak.
      await seedFile(
        fs,
        ZIP_PATH,
        makeZip([
          { name: "SKILL.md", data: skillMd("name: aman") },
          { name, data: "jahat" },
        ]),
      );
      fs.writes.length = 0;

      const error = await caught(importZipSkill(fs, DATA_ROOT, importOptions()));

      expect(error.code).toBe("unsafe_zip_entry");
      expect(fs.writes).toEqual([]);
      expect(await fs.exists(path.join(DATA_ROOT, "library"))).toBe(false);
    }
  });

  it("menolak entri symlink tanpa menulis apa pun", async () => {
    const fs = new RecordingFileSystem();
    await seedFile(
      fs,
      ZIP_PATH,
      makeZip([{ name: "tautan", data: "/etc/passwd", mode: 0o120777 }]),
    );
    fs.writes.length = 0;

    const error = await caught(importZipSkill(fs, DATA_ROOT, importOptions()));

    expect(error.code).toBe("unsafe_symlink");
    expect(fs.writes).toEqual([]);
  });

  it("menolak arsip yang CRC-nya tidak cocok", async () => {
    const fs = new RecordingFileSystem();
    const bytes = makeZip([{ name: "SKILL.md", data: "---\nname: crc\n---\n", stored: true }]);
    const index = Buffer.from(bytes).indexOf(Buffer.from("name: crc"));
    bytes[index] = 0x00;
    await seedFile(fs, ZIP_PATH, bytes);
    fs.writes.length = 0;

    const error = await caught(importZipSkill(fs, DATA_ROOT, importOptions()));

    expect(error.code).toBe("zip_invalid");
    expect(fs.writes).toEqual([]);
  });

  it("menolak arsip yang bukan zip", async () => {
    const fs = new RecordingFileSystem();
    await seedFile(fs, ZIP_PATH, "ini bukan zip sama sekali");
    fs.writes.length = 0;

    const error = await caught(importZipSkill(fs, DATA_ROOT, importOptions()));

    expect(error.code).toBe("zip_invalid");
    expect(fs.writes).toEqual([]);
  });
});

describe("importZipSkill — batas ukuran dan jumlah file", () => {
  it("menolak arsip dengan lebih dari 1000 entri", async () => {
    const fs = new RecordingFileSystem();
    const seeds = Array.from({ length: 1001 }, (_, index) => ({
      name: `berkas/f${index}.txt`,
      data: "x",
    }));
    await seedFile(fs, ZIP_PATH, makeZip(seeds));
    fs.writes.length = 0;

    const error = await caught(importZipSkill(fs, DATA_ROOT, importOptions()));

    expect(error.code).toBe("source_too_many_files");
    expect(fs.writes).toEqual([]);
    expect(await fs.exists(path.join(DATA_ROOT, "library"))).toBe(false);
  });

  it("menolak arsip yang isinya melebihi 10 MiB setelah diekstrak", async () => {
    const fs = new RecordingFileSystem();
    const tooBig = new Uint8Array(10 * 1024 * 1024 + 1);
    await seedFile(fs, ZIP_PATH, makeZip([{ name: "besar.bin", data: tooBig }]));
    fs.writes.length = 0;

    const error = await caught(importZipSkill(fs, DATA_ROOT, importOptions()));

    expect(error.code).toBe("source_too_large");
    expect(fs.writes).toEqual([]);
  });
});

describe("importZipSkill — impor sukses", () => {
  it("mengekstrak zip valid lalu memasukkan skill ke Library dengan provenance zip", async () => {
    const fs = new RecordingFileSystem();
    await seedFile(
      fs,
      ZIP_PATH,
      makeZip([
        { name: "SKILL.md", data: skillMd("name: brainstorming\nlicense: MIT") },
        { name: "references/teknik.md", data: "# Teknik\n" },
        { name: "scripts/", mode: 0o040755 },
      ]),
    );

    const result = await importZipSkill(fs, DATA_ROOT, importOptions());

    expect(result.skill).toMatchObject({
      id: FIXED_ID,
      name: "brainstorming",
      source: { type: "zip", path: ZIP_PATH },
      license: "MIT",
      importedAt: FIXED_NOW,
    });
    expect(result.skill.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(
      ok(
        await fs.readText(
          path.join(DATA_ROOT, "library", "brainstorming", "references", "teknik.md"),
        ),
      ),
    ).toBe("# Teknik\n");

    const saved = await loadState(fs, DATA_ROOT);
    expect(saved.status).toBe("loaded");
    expect(saved.state.library.at(0)).toEqual(result.skill);
  });

  it("menerima zip yang membungkus satu folder skill", async () => {
    const fs = new RecordingFileSystem();
    await seedFile(
      fs,
      ZIP_PATH,
      makeZip([
        { name: "paket/", mode: 0o040755 },
        { name: "paket/SKILL.md", data: skillMd("name: terbungkus") },
      ]),
    );

    const result = await importZipSkill(fs, DATA_ROOT, importOptions());

    expect(result.skill.name).toBe("terbungkus");
  });

  it("menerima entri stored (tanpa kompresi)", async () => {
    const fs = new RecordingFileSystem();
    await seedFile(
      fs,
      ZIP_PATH,
      makeZip([{ name: "SKILL.md", data: skillMd("name: stored"), stored: true }]),
    );

    const result = await importZipSkill(fs, DATA_ROOT, importOptions());

    expect(result.skill.name).toBe("stored");
  });

  it("menghapus direktori sementara setelah impor berhasil", async () => {
    const fs = new RecordingFileSystem();
    await seedFile(fs, ZIP_PATH, makeZip([{ name: "SKILL.md", data: skillMd("name: bersih") }]));

    await importZipSkill(fs, DATA_ROOT, importOptions());

    expect(await fs.exists(UNZIP)).toBe(false);
    expect(await fs.exists(TEMP_ROOT)).toBe(true);
  });

  it("menghapus direktori sementara saat ekstrak/impor gagal", async () => {
    const fs = new RecordingFileSystem();
    await seedFile(fs, ZIP_PATH, makeZip([{ name: "README.md", data: "bukan skill" }]));

    const error = await caught(importZipSkill(fs, DATA_ROOT, importOptions()));

    expect(error.code).toBe("skill_md_missing");
    expect(await fs.exists(UNZIP)).toBe(false);
  });
});

describe("importZipSkill — nama direktori sementara", () => {
  it("menolak nama sementara yang bisa menghapus direktori di luar induk", async () => {
    const fs = new MemoryFileSystem();
    await seedFile(fs, ZIP_PATH, makeZip([{ name: "SKILL.md", data: skillMd("name: aman") }]));

    const error = await caught(
      importZipSkill(fs, DATA_ROOT, { ...importOptions(), newTempDirName: () => "../keluar" }),
    );

    expect(error.code).toBe("zip_extract_failed");
    // "../keluar" akan menunjuk ke luar TEMP_ROOT; guard mencegah ekstrak/hapus.
    expect(await fs.exists(ROOT)).toBe(true);
    expect(await fs.exists(ZIP_PATH)).toBe(true);
  });
});
