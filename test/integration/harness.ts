/**
 * Perkakas bersama uji integrasi (ticket 11).
 *
 * Setiap test mendapat direktori sementara sungguhan dari `os.tmpdir()` dengan
 * nama acak. `dataRoot` DAN `home` palsu berada di dalamnya, jadi tidak ada
 * satu pun Store yang menyentuh home directory asli (kontrak §9).
 */
import { cp, mkdir, mkdtemp, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import { type Adapter, loadAdapters } from "../../src/adapters/index.js";
import { NodeFileSystem } from "../../src/fs/node.js";
import type { ProcessResult, ProcessRunOptions } from "../../src/fs/process.js";
import { FakeProcessRunner } from "../../src/fs/process-fake.js";
import { type FsResult, fsOk } from "../../src/fs/types.js";

/** Akar `test/fixtures` — fixture nyata di disk, bukan digenerate saat test. */
export const FIXTURES_DIR = fileURLToPath(new URL("../fixtures", import.meta.url));

/** Fixture yang tersedia (matriks spec §16). */
export const FIXTURES = {
  tipeA: "tipeA-markdown",
  tipeB: "tipeB-scripts",
  tipeC: "tipeC-python",
  tipeD: "tipeD-rusak",
  tipeE: "tipeE-frontmatter-rusak",
} as const;

export type FixtureName = (typeof FIXTURES)[keyof typeof FIXTURES];

/** Buka `FsResult` atau gagalkan test dengan pesan yang menyebut sebabnya. */
export function ok<T>(result: FsResult<T>): T {
  if (!result.ok) {
    throw new Error(`Operasi gagal: ${result.error.code} — ${result.error.message}`);
  }
  return result.value;
}

export interface IntegrationHarness {
  readonly fs: NodeFileSystem;
  /** Direktori sementara pemilik seluruh isi test; dihapus di afterEach. */
  readonly base: string;
  /** Data root aplikasi (Library, state.json, deps). */
  readonly dataRoot: string;
  /** Home palsu; semua Store di bawahnya. */
  readonly home: string;
  /** Induk folder sumber hasil salin fixture. */
  readonly sources: string;
  /** Manifest adapter bawaan + pengguna (tidak ada jaringan). */
  adapters(): Promise<readonly Adapter[]>;
  /** Salin fixture ke direktori sementara sebagai folder sumber impor. */
  copyFixture(name: FixtureName, as?: string): Promise<string>;
  /** Path Library sebuah skill. */
  libraryDir(name: string): string;
  /** Path skill di Store berdasarkan path Store yang diexpand terhadap `home`. */
  storeSkillPath(storeDir: string, skillName: string): string;
  /** Hapus seluruh direktori sementara; idempoten. */
  cleanup(): Promise<void>;
}

/** Buat harness baru. Pemanggil WAJIB membersihkannya di `afterEach`. */
export async function createHarness(prefix = "integration"): Promise<IntegrationHarness> {
  const base = await mkdtemp(path.join(tmpdir(), `sm-${prefix}-`));
  const home = path.join(base, "home");
  const sources = path.join(base, "sources");
  const dataRoot = path.join(base, "data");
  await mkdir(home, { recursive: true });
  await mkdir(sources, { recursive: true });

  const fs = new NodeFileSystem();
  let cached: readonly Adapter[] | undefined;

  return {
    fs,
    base,
    dataRoot,
    home,
    sources,
    async adapters() {
      if (cached === undefined) {
        cached = (await loadAdapters({ fs, dataRoot })).adapters;
      }
      return cached;
    },
    async copyFixture(name, as = name) {
      const destination = path.join(sources, as);
      await cp(path.join(FIXTURES_DIR, name), destination, { recursive: true });
      return destination;
    },
    libraryDir(name) {
      return path.join(dataRoot, "library", name);
    },
    storeSkillPath(storeDir, skillName) {
      return path.join(
        home,
        ...storeDir
          .replace(/^~[\\/]/u, "")
          .split("/")
          .filter(Boolean),
        skillName,
      );
    },
    async cleanup() {
      await rm(base, { recursive: true, force: true });
    },
  };
}

interface ZipEntryInput {
  readonly name: string;
  readonly data: Buffer;
}

const UTF8_FLAG = 0x0800;
const STORED = 0;

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

/**
 * Susun arsip zip "stored" tanpa dependensi npm. Dipakai test untuk membuat
 * arsip dari fixture saat test berjalan (fixture di disk tetap sumbernya).
 */
export function buildZip(entries: readonly ZipEntryInput[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data) >>> 0;

    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(UTF8_FLAG),
      u16(STORED),
      u16(0),
      u16(0x0021),
      u32(crc),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      name,
      entry.data,
    ]);
    locals.push(local);

    centrals.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(0x0314),
        u16(20),
        u16(UTF8_FLAG),
        u16(STORED),
        u16(0),
        u16(0x0021),
        u32(crc),
        u32(entry.data.length),
        u32(entry.data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0o100644 << 16),
        u32(offset),
        name,
      ]),
    );
    offset += local.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDirectory.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, centralDirectory, end]);
}

/** Baca seluruh isi direktori menjadi entri zip (nama memakai pemisah "/"). */
export async function zipDirectory(directory: string): Promise<Buffer> {
  const entries: ZipEntryInput[] = [];

  async function walk(current: string, prefix: string): Promise<void> {
    const listing = await readdir(current, { withFileTypes: true });
    for (const dirent of listing) {
      const full = path.join(current, dirent.name);
      const name = prefix === "" ? dirent.name : `${prefix}/${dirent.name}`;
      if (dirent.isDirectory()) {
        await walk(full, name);
        continue;
      }
      entries.push({ name, data: await readFile(full) });
    }
  }

  await walk(directory, "");
  return buildZip(entries);
}

/**
 * Zip sebuah fixture dari disk ke direktori sementara harness. Arsip dibuat
 * saat test berjalan dari fixture nyata, bukan disimpan sebagai biner di repo.
 */
export async function zipFixture(
  harness: IntegrationHarness,
  fixture: FixtureName,
): Promise<string> {
  const archivePath = path.join(harness.base, `${fixture}.zip`);
  await writeFile(archivePath, await zipDirectory(path.join(FIXTURES_DIR, fixture)));
  return archivePath;
}

const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}$/u;

/**
 * ProcessRunner palsu untuk impor git: `git clone` TIDAK menjalankan proses
 * sungguhan, melainkan menyalin fixture ke direktori tujuan clone. Tidak ada
 * jaringan sama sekali; setiap pemanggilan tetap direkam untuk assertion.
 */
export class FixtureGitRunner extends FakeProcessRunner {
  private readonly repos = new Map<string, { readonly dir: string; readonly commit: string }>();
  private lastCommit = "0".repeat(40);

  /** Daftarkan URL repositori -> fixture yang "di-clone". */
  repo(url: string, fixture: FixtureName, commit: string): this {
    if (!GIT_COMMIT_PATTERN.test(commit)) {
      throw new Error(`Commit fixture harus 40 hex: ${commit}`);
    }
    this.repos.set(url, { dir: path.join(FIXTURES_DIR, fixture), commit });
    return this;
  }

  override async run(
    command: string,
    args: readonly string[],
    options: ProcessRunOptions = {},
  ): Promise<FsResult<ProcessResult>> {
    const recorded = await super.run(command, args, options);

    if (command === "git" && args[0] === "clone") {
      const url = args.at(-2);
      const destination = args.at(-1);
      const repo = url === undefined ? undefined : this.repos.get(url);
      if (repo === undefined || destination === undefined) {
        throw new Error(`URL git tidak terdaftar di FixtureGitRunner: ${url ?? "(kosong)"}`);
      }
      await cp(repo.dir, destination, { recursive: true });
      this.lastCommit = repo.commit;
      return fsOk({ code: 0, stdout: "", stderr: "", timedOut: false });
    }

    if (command === "git" && args[0] === "rev-parse") {
      return fsOk({ code: 0, stdout: `${this.lastCommit}\n`, stderr: "", timedOut: false });
    }

    return recorded;
  }

  /** Perintah yang bukan git berarti ada eksekusi tak terduga. */
  get nonGitCalls(): readonly string[] {
    return this.calls.filter((call) => call.command !== "git").map((call) => call.command);
  }
}

/** Hapus satu file bila ada; dipakai untuk mensimulasikan drift. */
export async function removeIfExists(target: string): Promise<void> {
  await unlink(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });
}
