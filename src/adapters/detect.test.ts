import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Harness } from "../core/types.js";
import { MemoryFileSystem } from "../fs/memory.js";
import { FakeProcessRunner } from "../fs/process-fake.js";
import type { FileSystem, FsResult } from "../fs/types.js";
import { detectHarnesses, recheck } from "./detect.js";
import { loadAdapters } from "./loader.js";
import type { Adapter } from "./manifest.js";

const HOME = path.resolve(path.sep, "sm-home");
const DATA_ROOT = path.resolve(path.sep, "sm-detect-data");
const BIN_DIR = path.join(HOME, "bin");

function ok<T>(result: FsResult<T>): T {
  if (!result.ok) {
    throw new Error(`Operasi gagal: ${result.error.code} — ${result.error.message}`);
  }
  return result.value;
}

async function seedFile(fs: FileSystem, filePath: string, text = "x"): Promise<void> {
  ok(await fs.mkdir(path.dirname(filePath), { recursive: true }));
  ok(await fs.write(filePath, text));
}

async function seedDir(fs: FileSystem, dir: string): Promise<void> {
  ok(await fs.mkdir(dir, { recursive: true }));
}

async function bundled(): Promise<readonly Adapter[]> {
  const catalog = await loadAdapters({ fs: new MemoryFileSystem(), dataRoot: DATA_ROOT });
  return catalog.adapters;
}

function detect(fs: FileSystem, runner: FakeProcessRunner, adapters: readonly Adapter[]) {
  return detectHarnesses(adapters, { fs, runner, home: HOME, env: { PATH: BIN_DIR } });
}

function harnessOf(harnesses: readonly Harness[], id: string) {
  const found = harnesses.find((harness) => harness.id === id);
  if (found === undefined) {
    throw new Error(`Harness "${id}" tidak ada di hasil deteksi`);
  }
  return found;
}

describe("detectHarnesses — path", () => {
  it("menandai harness terdeteksi saat direktori deteksinya ada", async () => {
    const fs = new MemoryFileSystem();
    await seedDir(fs, path.join(HOME, ".claude"));

    const harnesses = await detect(fs, new FakeProcessRunner(), await bundled());
    const claudeCode = harnessOf(harnesses, "claude-code");

    expect(claudeCode.detected).toBe(true);
    expect(claudeCode.capability).toBe("managed");
    expect(claudeCode.detectionReasons).toContain("ditemukan ~/.claude");
  });

  it("tahan terhadap home yang tidak punya direktori harness sama sekali", async () => {
    const runner = new FakeProcessRunner();
    const harnesses = await detect(new MemoryFileSystem(), runner, await bundled());

    expect(harnesses).toHaveLength(8);
    expect(harnesses.every((harness) => harness.detected === false)).toBe(true);
    expect(harnessOf(harnesses, "claude-code").detectionReasons).toContain("~/.claude tidak ada");
    expect(runner.calls).toEqual([]);
  });
});

describe("detectHarnesses — binary", () => {
  it("menemukan binary di PATH lalu memverifikasinya dengan --version", async () => {
    const fs = new MemoryFileSystem();
    const binary = path.join(BIN_DIR, "opencode");
    await seedFile(fs, binary);
    const runner = new FakeProcessRunner().on(binary, ["--version"], {
      type: "exit",
      code: 0,
      stdout: "2.0.24",
    });

    const harnesses = await detect(fs, runner, await bundled());
    const opencode = harnessOf(harnesses, "opencode");

    expect(opencode.detected).toBe(true);
    expect(opencode.detectionReasons).toContain("opencode --version menjawab");
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.command).toBe(binary);
    expect(runner.calls[0]?.args).toEqual(["--version"]);
    expect(runner.calls[0]?.options.timeoutMs).toBe(5000);
  });

  it("tidak memanggil --version saat binary tidak ditemukan", async () => {
    const runner = new FakeProcessRunner();
    const harnesses = await detect(new MemoryFileSystem(), runner, await bundled());

    expect(harnessOf(harnesses, "opencode").detectionReasons).toContain(
      "opencode tidak ditemukan di PATH",
    );
    expect(runner.calls).toEqual([]);
  });

  it("timeout verifikasi tidak membatalkan deteksi berbasis path", async () => {
    const fs = new MemoryFileSystem();
    await seedDir(fs, path.join(HOME, ".claude"));
    const binary = path.join(BIN_DIR, "claude");
    await seedFile(fs, binary);
    const runner = new FakeProcessRunner().on(binary, ["--version"], { type: "timeout" });

    const harnesses = await detect(fs, runner, await bundled());
    const claudeCode = harnessOf(harnesses, "claude-code");

    expect(claudeCode.detected).toBe(true);
    expect(claudeCode.detectionReasons).toContain("ditemukan ~/.claude");
    expect(claudeCode.detectionReasons).toContain("claude --version tidak menjawab dalam 5000 ms");
  });

  it("exit code bukan nol tetap terdeteksi tetapi alasannya dilaporkan", async () => {
    const fs = new MemoryFileSystem();
    const binary = path.join(BIN_DIR, "opencode");
    await seedFile(fs, binary);
    const runner = new FakeProcessRunner().on(binary, ["--version"], { type: "exit", code: 3 });

    const harnesses = await detect(fs, runner, await bundled());
    const opencode = harnessOf(harnesses, "opencode");

    expect(opencode.detected).toBe(true);
    expect(opencode.detectionReasons).toContain("opencode --version keluar dengan kode 3");
  });
});

describe("detectHarnesses — tingkat kemampuan", () => {
  it("menurunkan adapter managed tanpa verified.at menjadi detected", async () => {
    const fs = new MemoryFileSystem();
    await seedFile(
      fs,
      path.join(DATA_ROOT, "adapters", "opencode.json"),
      JSON.stringify({
        id: "opencode",
        name: "opencode",
        tier: "managed",
        detect: {
          paths: ["~/.config/opencode"],
          binaries: ["opencode"],
          versionArgs: ["--version"],
        },
        stores: [{ scope: "global", path: "~/.config/opencode/skills", exclusive: true }],
        readsShared: true,
      }),
    );
    const catalog = await loadAdapters({ fs, dataRoot: DATA_ROOT });

    const harnesses = await detectHarnesses(catalog.adapters, {
      fs,
      runner: new FakeProcessRunner(),
      home: HOME,
      env: { PATH: BIN_DIR },
    });
    const opencode = harnessOf(harnesses, "opencode");

    expect(opencode.capability).toBe("detected");
    expect(opencode.storeIds).toEqual([]);
    expect(opencode.detectionReasons.some((reason) => reason.includes("verified.at"))).toBe(true);
  });

  it("harness detected-only tidak punya Store dan menyebut alasannya", async () => {
    const harnesses = await detect(
      new MemoryFileSystem(),
      new FakeProcessRunner(),
      await bundled(),
    );
    const hermes = harnessOf(harnesses, "hermes");

    expect(hermes.capability).toBe("detected");
    expect(hermes.storeIds).toEqual([]);
    expect(hermes.detectionReasons.some((reason) => reason.includes("detected-only"))).toBe(true);
    expect(hermes.connect?.installUrl).toMatch(/^https:\/\//);
  });

  it("mencatat pertentangan path Devin sebagai alasan yang bisa ditampilkan", async () => {
    const harnesses = await detect(
      new MemoryFileSystem(),
      new FakeProcessRunner(),
      await bundled(),
    );
    const devin = harnessOf(harnesses, "devin");

    expect(devin.detectionReasons.some((reason) => reason.includes("BERTENTANGAN"))).toBe(true);
    expect(devin.detectionReasons.some((reason) => reason.includes("%APPDATA%"))).toBe(true);
  });
});

describe("recheck", () => {
  it("menemukan harness dan manifest pengguna baru tanpa restart", async () => {
    const fs = new MemoryFileSystem();
    const runner = new FakeProcessRunner();
    const options = { fs, dataRoot: DATA_ROOT, runner, home: HOME, env: { PATH: BIN_DIR } };

    const before = await recheck(options);
    expect(harnessOf(before.harnesses, "opencode").detected).toBe(false);

    await seedDir(fs, path.join(HOME, ".config", "opencode"));
    await seedFile(fs, path.join(DATA_ROOT, "adapters", "kilocode.json"));
    ok(
      await fs.write(
        path.join(DATA_ROOT, "adapters", "kilocode.json"),
        JSON.stringify({
          id: "kilocode",
          name: "Kilo Code",
          tier: "detected-only",
          detect: { paths: ["~/.kilocode"], binaries: [], versionArgs: [] },
          stores: [],
          readsShared: false,
        }),
      ),
    );

    const after = await recheck(options);

    expect(harnessOf(after.harnesses, "opencode").detected).toBe(true);
    expect(after.adapters.some((adapter) => adapter.id === "kilocode")).toBe(true);
    expect(after.harnesses).toHaveLength(9);
    expect(after.problems).toEqual([]);
  });
});
