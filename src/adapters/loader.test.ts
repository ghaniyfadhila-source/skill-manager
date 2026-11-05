import path from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "../fs/memory.js";
import type { FileSystem, FsResult } from "../fs/types.js";
import { loadAdapters } from "./loader.js";

const DATA_ROOT = path.resolve(path.sep, "sm-adapters");

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

function customOpencode(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "opencode",
    name: "opencode (kustom)",
    tier: "managed",
    detect: { paths: ["~/.opencode"], binaries: ["opencode"], versionArgs: ["--version"] },
    stores: [{ scope: "global", path: "~/.opencode/skills", exclusive: true }],
    readsShared: false,
    verified: { at: "2026-11-05", source: "https://example.test/opencode" },
    ...overrides,
  });
}

describe("loadAdapters — manifest bawaan", () => {
  it("memuat empat adapter managed dan empat harness detected-only", async () => {
    const catalog = await loadAdapters({ fs: new MemoryFileSystem(), dataRoot: DATA_ROOT });

    expect(catalog.problems).toEqual([]);
    expect(catalog.adapters.map((adapter) => adapter.id)).toEqual([
      "claude-code",
      "opencode",
      "antigravity",
      "shared",
      "hermes",
      "goose",
      "crush",
      "devin",
    ]);
    expect(catalog.adapters.filter((adapter) => adapter.tier === "managed")).toHaveLength(4);
  });

  it("menyimpan verified.at dan verified.source untuk setiap adapter managed", async () => {
    const catalog = await loadAdapters({ fs: new MemoryFileSystem(), dataRoot: DATA_ROOT });

    for (const adapter of catalog.adapters) {
      expect(adapter.verified?.at).toBe("2026-11-05");
      expect(adapter.verified?.source).toMatch(/^https:\/\//);
    }
  });

  it("shared memuat member yang tercatat di spec §5.1", async () => {
    const catalog = await loadAdapters({ fs: new MemoryFileSystem(), dataRoot: DATA_ROOT });
    const shared = catalog.adapters.find((adapter) => adapter.id === "shared");

    expect(shared?.stores[0]?.exclusive).toBe(false);
    expect(shared?.stores[0]?.members).toEqual([
      "codex",
      "gemini",
      "cursor",
      "copilot",
      "amp",
      "zed",
      "roo",
      "kilo",
      "factory",
      "dsh",
    ]);
  });
});

describe("loadAdapters — manifest pengguna", () => {
  it("menimpa manifest bawaan berdasarkan id", async () => {
    const fs = new MemoryFileSystem();
    await seedFile(fs, path.join(DATA_ROOT, "adapters", "opencode.json"), customOpencode());

    const catalog = await loadAdapters({ fs, dataRoot: DATA_ROOT });
    const opencode = catalog.adapters.filter((adapter) => adapter.id === "opencode");

    expect(opencode).toHaveLength(1);
    expect(opencode[0]?.name).toBe("opencode (kustom)");
    expect(opencode[0]?.stores[0]?.path).toBe("~/.opencode/skills");
    expect(catalog.adapters).toHaveLength(8);
  });

  it("menambahkan adapter baru dengan id yang belum dikenal", async () => {
    const fs = new MemoryFileSystem();
    await seedFile(
      fs,
      path.join(DATA_ROOT, "adapters", "kilocode.json"),
      JSON.stringify({
        id: "kilocode",
        name: "Kilo Code",
        tier: "detected-only",
        detect: { paths: ["~/.kilocode"], binaries: [], versionArgs: [] },
        stores: [],
        readsShared: false,
      }),
    );

    const catalog = await loadAdapters({ fs, dataRoot: DATA_ROOT });

    expect(catalog.adapters).toHaveLength(9);
    expect(catalog.adapters.at(-1)?.id).toBe("kilocode");
  });

  it("melaporkan manifest pengguna yang tidak valid tanpa membuang manifest bawaan", async () => {
    const fs = new MemoryFileSystem();
    await seedFile(
      fs,
      path.join(DATA_ROOT, "adapters", "rusak.json"),
      JSON.stringify({ id: "rusak", name: "Rusak" }),
    );

    const catalog = await loadAdapters({ fs, dataRoot: DATA_ROOT });

    expect(catalog.adapters).toHaveLength(8);
    expect(catalog.problems).toHaveLength(1);
    expect(catalog.problems[0]?.file).toContain("rusak.json");
    expect(catalog.problems[0]?.message).toContain("tier");
  });

  it("melaporkan JSON yang tidak bisa diparse", async () => {
    const fs = new MemoryFileSystem();
    await seedFile(fs, path.join(DATA_ROOT, "adapters", "setengah.json"), "{ bukan json");

    const catalog = await loadAdapters({ fs, dataRoot: DATA_ROOT });

    expect(catalog.problems).toHaveLength(1);
    expect(catalog.problems[0]?.message).toContain("JSON");
  });

  it("tidak gagal saat direktori adapters belum ada", async () => {
    const catalog = await loadAdapters({ fs: new MemoryFileSystem(), dataRoot: DATA_ROOT });

    expect(catalog.problems).toEqual([]);
    // Delapan manifest bawaan (kontrak §6); angka tetap agar manifest yang
    // hilang dari bundel ketahuan, bukan sekadar "lebih dari nol".
    expect(catalog.adapters).toHaveLength(8);
  });
});
