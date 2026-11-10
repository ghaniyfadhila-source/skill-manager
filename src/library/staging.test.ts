import path from "node:path";
import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "../fs/memory.js";
import { FakeProcessRunner } from "../fs/process-fake.js";
import {
  cleanStaleStaging,
  discardStaged,
  importStaged,
  readStaged,
  STAGING_DIR_NAME,
  stageFromFolder,
  stageFromGit,
  stageFromZip,
} from "./staging.js";

const DATA_ROOT = "/data";
const SKILL_MD = [
  "---",
  "name: demo",
  "description: Skill demo",
  "---",
  "",
  "# Demo",
  "",
  "Isi.",
  "",
].join("\n");

async function mkdirp(fs: MemoryFileSystem, dir: string): Promise<void> {
  const created = await fs.mkdir(dir, { recursive: true });
  expect(created.ok).toBe(true);
}

async function put(fs: MemoryFileSystem, target: string, text: string): Promise<void> {
  await mkdirp(fs, path.dirname(target));
  const written = await fs.write(target, text);
  expect(written.ok).toBe(true);
}

async function seeded(): Promise<MemoryFileSystem> {
  const fs = new MemoryFileSystem();
  await put(fs, "/source/demo/SKILL.md", SKILL_MD);
  await put(fs, "/source/demo/references/a.md", "# A\n");
  return fs;
}

const fixedId = () => "fixed";
const fixedNow = () => "2026-11-05T00:00:00.000Z";
const options = { newStagingId: fixedId, now: fixedNow };

describe("stageFromFolder", () => {
  it("menyalin sumber ke staging dan mengembalikan pratinjau", async () => {
    const fs = await seeded();
    const staged = await stageFromFolder(fs, DATA_ROOT, "/source/demo", options);

    expect(staged.stagingId).toBe("stg_fixed");
    expect(staged.suggestedName).toBe("demo");
    expect(staged.inspect.totalBytes).toBeGreaterThan(0);
    expect(staged.inspect.files.map((node) => node.name)).toContain("SKILL.md");
    expect(staged.provenance).toEqual({ type: "folder", path: path.resolve("/source/demo") });
  });

  it("tidak menulis apa pun ke Library saat hanya pratinjau", async () => {
    const fs = await seeded();
    await stageFromFolder(fs, DATA_ROOT, "/source/demo", options);

    const library = await fs.readdir(path.join(DATA_ROOT, "library"));
    expect(library.ok).toBe(false);
  });

  it("membuang staging yang gagal disiapkan", async () => {
    const fs = await seeded();
    await expect(stageFromFolder(fs, DATA_ROOT, "/source/kosong", options)).rejects.toThrow(
      /tidak bisa dibaca|tidak ditemukan/,
    );

    const staging = await fs.readdir(path.join(DATA_ROOT, STAGING_DIR_NAME));
    expect(staging.ok ? staging.value.length : 0).toBe(0);
  });

  it("menolak sumber tanpa SKILL.md dan tidak meninggalkan staging", async () => {
    const fs = await seeded();
    await put(fs, "/source/rusak/README.md", "# bukan skill\n");

    await expect(stageFromFolder(fs, DATA_ROOT, "/source/rusak", options)).rejects.toThrow();
    const staging = await fs.readdir(path.join(DATA_ROOT, STAGING_DIR_NAME));
    expect(staging.ok ? staging.value.length : 0).toBe(0);
  });
});

describe("stageFromGit", () => {
  const SHA = "0123456789abcdef0123456789abcdef01234567";
  const URL = "https://example.com/r.git";
  const cloneDest = () => path.join(DATA_ROOT, STAGING_DIR_NAME, "stg_fixed");

  it("memakai commit hasil clone sebagai provenance", async () => {
    const fs = await seeded();
    // Isi hasil clone disemai lebih dulu: FakeProcessRunner tidak membuat berkas.
    await put(fs, path.join(cloneDest(), "SKILL.md"), SKILL_MD);

    const runner = new FakeProcessRunner();
    runner.on("git", ["clone", "--depth", "1", URL, cloneDest()], { type: "exit", code: 0 });
    runner.on("git", ["rev-parse", "HEAD"], { type: "exit", code: 0, stdout: `${SHA}\n` });

    const staged = await stageFromGit(fs, DATA_ROOT, runner, { url: URL }, options);

    expect(staged.provenance).toEqual({ type: "git", url: URL, ref: "HEAD", commit: SHA });
    // Clone dangkal wajib dipakai agar unduhan tidak menarik seluruh riwayat.
    expect(runner.calls[0]?.args).toContain("--depth");
  });

  it("membuang staging bila clone gagal", async () => {
    const fs = await seeded();
    const runner = new FakeProcessRunner();
    runner.otherwise({ type: "exit", code: 128, stderr: "fatal: repository not found" });

    await expect(stageFromGit(fs, DATA_ROOT, runner, { url: URL }, options)).rejects.toThrow(
      /clone gagal/,
    );

    const staging = await fs.readdir(path.join(DATA_ROOT, STAGING_DIR_NAME));
    expect(staging.ok ? staging.value.length : 0).toBe(0);
  });

  const DOCX_MD = ["---", "name: docx", "description: buat dokumen", "---", "", "# Docx", ""].join(
    "\n",
  );

  it("memakai subdir untuk menunjuk satu skill di dalam monorepo", async () => {
    const fs = await seeded();
    await put(fs, path.join(cloneDest(), "skills", "docx", "SKILL.md"), DOCX_MD);
    await put(fs, path.join(cloneDest(), "skills", "pdf", "SKILL.md"), SKILL_MD);

    const runner = new FakeProcessRunner();
    runner.on("git", ["clone", "--depth", "1", URL, cloneDest()], { type: "exit", code: 0 });
    runner.on("git", ["rev-parse", "HEAD"], { type: "exit", code: 0, stdout: `${SHA}\n` });

    const staged = await stageFromGit(
      fs,
      DATA_ROOT,
      runner,
      { url: URL, subdir: "skills/docx" },
      options,
    );

    expect(staged.suggestedName).toBe("docx");
    expect(staged.inspect.files.map((node) => node.name)).toContain("SKILL.md");
  });

  it("impor tahap kedua menghormati subdir yang tersimpan", async () => {
    const fs = await seeded();
    await put(fs, path.join(cloneDest(), "skills", "docx", "SKILL.md"), DOCX_MD);
    await put(fs, path.join(cloneDest(), "skills", "pdf", "SKILL.md"), SKILL_MD);

    const runner = new FakeProcessRunner();
    runner.on("git", ["clone", "--depth", "1", URL, cloneDest()], { type: "exit", code: 0 });
    runner.on("git", ["rev-parse", "HEAD"], { type: "exit", code: 0, stdout: `${SHA}\n` });

    const staged = await stageFromGit(
      fs,
      DATA_ROOT,
      runner,
      { url: URL, subdir: "skills/docx" },
      options,
    );
    const result = await importStaged(fs, DATA_ROOT, staged.stagingId, { now: fixedNow });

    expect(result.skill.name).toBe("docx");
    expect(result.skill.source).toEqual({ type: "git", url: URL, ref: "HEAD", commit: SHA });
  });

  it("menolak subdir tanpa SKILL.md", async () => {
    const fs = await seeded();
    await put(fs, path.join(cloneDest(), "skills", "docx", "SKILL.md"), DOCX_MD);

    const runner = new FakeProcessRunner();
    runner.on("git", ["clone", "--depth", "1", URL, cloneDest()], { type: "exit", code: 0 });
    runner.on("git", ["rev-parse", "HEAD"], { type: "exit", code: 0, stdout: `${SHA}\n` });

    await expect(
      stageFromGit(fs, DATA_ROOT, runner, { url: URL, subdir: "skills/pdf" }, options),
    ).rejects.toThrow(/tidak berisi SKILL\.md/);
  });

  it.each([
    ["../keluar", /menunjuk keluar|tidak valid/],
    ["skills/../pdf", /tidak valid/],
    ["/absolut", /tidak valid/],
    ["skills\\docx", /tidak valid/],
  ])("menolak subdir berbahaya: %s", async (subdir, pesan) => {
    const fs = await seeded();
    await put(fs, path.join(cloneDest(), "skills", "docx", "SKILL.md"), DOCX_MD);

    const runner = new FakeProcessRunner();
    runner.on("git", ["clone", "--depth", "1", URL, cloneDest()], { type: "exit", code: 0 });
    runner.on("git", ["rev-parse", "HEAD"], { type: "exit", code: 0, stdout: `${SHA}\n` });

    await expect(
      stageFromGit(fs, DATA_ROOT, runner, { url: URL, subdir }, options),
    ).rejects.toThrow(pesan);
  });
});
describe("stageFromZip", () => {
  /** Bangun zip stored (tanpa kompresi) agar test tidak butuh dependensi. */
  function storedZip(files: readonly { name: string; content: string }[]): Uint8Array {
    const encoder = new TextEncoder();
    const locals: Uint8Array[] = [];
    const centrals: Uint8Array[] = [];
    let offset = 0;

    for (const file of files) {
      const name = encoder.encode(file.name);
      const data = encoder.encode(file.content);
      const crc = crc32(data);

      const local = new Uint8Array(30 + name.length + data.length);
      const localView = new DataView(local.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0, true);
      localView.setUint16(8, 0, true);
      localView.setUint32(14, crc, true);
      localView.setUint32(18, data.length, true);
      localView.setUint32(22, data.length, true);
      localView.setUint16(26, name.length, true);
      local.set(name, 30);
      local.set(data, 30 + name.length);
      locals.push(local);

      const central = new Uint8Array(46 + name.length);
      const centralView = new DataView(central.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint32(16, crc, true);
      centralView.setUint32(20, data.length, true);
      centralView.setUint32(24, data.length, true);
      centralView.setUint16(28, name.length, true);
      centralView.setUint32(42, offset, true);
      central.set(name, 46);
      centrals.push(central);

      offset += local.length;
    }

    const centralSize = centrals.reduce((total, part) => total + part.length, 0);
    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true);
    eocdView.setUint16(8, files.length, true);
    eocdView.setUint16(10, files.length, true);
    eocdView.setUint32(12, centralSize, true);
    eocdView.setUint32(16, offset, true);

    const parts = [...locals, ...centrals, eocd];
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const archive = new Uint8Array(total);
    let cursor = 0;
    for (const part of parts) {
      archive.set(part, cursor);
      cursor += part.length;
    }
    return archive;
  }

  async function withZip(): Promise<MemoryFileSystem> {
    const fs = await seeded();
    const archive = storedZip([{ name: "SKILL.md", content: SKILL_MD }]);
    await mkdirp(fs, "/arsip");
    const written = await fs.write("/arsip/demo.zip", archive);
    expect(written.ok).toBe(true);
    return fs;
  }

  it("mengekstrak zip ke staging lalu pratinjau tanpa mengimpor", async () => {
    const fs = await withZip();
    const staged = await stageFromZip(fs, DATA_ROOT, "/arsip/demo.zip", options);

    expect(staged.suggestedName).toBe("demo");
    expect(staged.provenance).toEqual({ type: "zip", path: path.resolve("/arsip/demo.zip") });
    expect(staged.inspect.files.map((node) => node.name)).toContain("SKILL.md");

    // Pratinjau tidak boleh menyentuh Library.
    const library = await fs.readdir(path.join(DATA_ROOT, "library"));
    expect(library.ok).toBe(false);
  });

  it("impor dari staging zip memakai provenance zip", async () => {
    const fs = await withZip();
    const staged = await stageFromZip(fs, DATA_ROOT, "/arsip/demo.zip", options);
    const result = await importStaged(fs, DATA_ROOT, staged.stagingId, { now: fixedNow });

    expect(result.skill.source).toEqual({ type: "zip", path: path.resolve("/arsip/demo.zip") });
    const staging = await fs.readdir(path.join(DATA_ROOT, STAGING_DIR_NAME));
    expect(staging.ok ? staging.value.length : 0).toBe(0);
  });

  it("menolak zip dengan entri yang keluar folder tujuan", async () => {
    const fs = await seeded();
    const archive = storedZip([{ name: "../keluar/SKILL.md", content: SKILL_MD }]);
    await mkdirp(fs, "/arsip");
    expect((await fs.write("/arsip/jahat.zip", archive)).ok).toBe(true);

    await expect(stageFromZip(fs, DATA_ROOT, "/arsip/jahat.zip", options)).rejects.toThrow(
      /keluar folder tujuan|Impor ditolak/,
    );
    const staging = await fs.readdir(path.join(DATA_ROOT, STAGING_DIR_NAME));
    expect(staging.ok ? staging.value.length : 0).toBe(0);
  });
});
describe("readStaged dan importStaged", () => {
  it("membaca kembali staging di request berikutnya", async () => {
    const fs = await seeded();
    const staged = await stageFromFolder(fs, DATA_ROOT, "/source/demo", options);

    const reread = await readStaged(fs, DATA_ROOT, staged.stagingId);
    expect(reread.meta.suggestedName).toBe("demo");
    expect(reread.meta.provenance).toEqual({ type: "folder", path: path.resolve("/source/demo") });
    expect(reread.inspect.files.length).toBeGreaterThan(0);
  });

  it("impor dari staging lalu menghapus staging", async () => {
    const fs = await seeded();
    const staged = await stageFromFolder(fs, DATA_ROOT, "/source/demo", options);

    const result = await importStaged(fs, DATA_ROOT, staged.stagingId, { now: fixedNow });
    expect(result.skill.name).toBe("demo");
    expect(result.skill.source).toEqual({ type: "folder", path: path.resolve("/source/demo") });

    const staging = await fs.readdir(path.join(DATA_ROOT, STAGING_DIR_NAME));
    expect(staging.ok ? staging.value.length : 0).toBe(0);
  });

  it("menghapus staging meski impor ditolak karena nama bentrok", async () => {
    const fs = await seeded();
    const first = await stageFromFolder(fs, DATA_ROOT, "/source/demo", options);
    await importStaged(fs, DATA_ROOT, first.stagingId, { now: fixedNow });

    const second = await stageFromFolder(fs, DATA_ROOT, "/source/demo", {
      newStagingId: () => "kedua",
      now: fixedNow,
    });
    await expect(importStaged(fs, DATA_ROOT, second.stagingId, { now: fixedNow })).rejects.toThrow(
      /sudah ada|bentrok|name_conflict/i,
    );

    const staging = await fs.readdir(path.join(DATA_ROOT, STAGING_DIR_NAME));
    expect(staging.ok ? staging.value.length : 0).toBe(0);
  });

  it("menolak id staging yang tidak dikenal", async () => {
    const fs = await seeded();
    await expect(readStaged(fs, DATA_ROOT, "stg_tidakada")).rejects.toThrow(/tidak ditemukan/);
  });

  it("menolak id staging yang mencoba keluar direktori", async () => {
    const fs = await seeded();
    await expect(readStaged(fs, DATA_ROOT, "stg_../../etc")).rejects.toThrow(/tidak valid/);
  });
});

describe("discardStaged dan cleanStaleStaging", () => {
  it("membuang staging atas permintaan", async () => {
    const fs = await seeded();
    const staged = await stageFromFolder(fs, DATA_ROOT, "/source/demo", options);
    await discardStaged(fs, DATA_ROOT, staged.stagingId);

    await expect(readStaged(fs, DATA_ROOT, staged.stagingId)).rejects.toThrow(/tidak ditemukan/);
  });

  it("membersihkan staging kedaluwarsa dan menyisakan yang baru", async () => {
    const fs = await seeded();
    const lama = await stageFromFolder(fs, DATA_ROOT, "/source/demo", {
      newStagingId: () => "lama",
      now: () => "2026-11-01T00:00:00.000Z",
    });
    const baru = await stageFromFolder(fs, DATA_ROOT, "/source/demo", {
      newStagingId: () => "baru",
      now: () => "2026-11-05T00:00:00.000Z",
    });

    const removed = await cleanStaleStaging(fs, DATA_ROOT, 24 * 60 * 60 * 1000, () =>
      Date.parse("2026-11-05T01:00:00.000Z"),
    );

    expect(removed).toHaveLength(1);
    expect(removed[0]).toContain(lama.stagingId);
    await expect(readStaged(fs, DATA_ROOT, baru.stagingId)).resolves.toBeDefined();
  });

  it("tidak menyentuh isi data root di luar direktori staging", async () => {
    const fs = await seeded();
    await put(fs, "/data/library/demo/SKILL.md", SKILL_MD);
    await stageFromFolder(fs, DATA_ROOT, "/source/demo", options);

    await cleanStaleStaging(fs, DATA_ROOT, 0, () => Date.parse("2030-01-01T00:00:00.000Z"));

    const kept = await fs.readText("/data/library/demo/SKILL.md");
    expect(kept.ok).toBe(true);
  });
});
