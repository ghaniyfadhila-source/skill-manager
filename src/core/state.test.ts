import path from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "../fs/memory.js";
import { type FsResult, fsErr } from "../fs/types.js";
import {
  CORRUPT_STATE_FILE_NAME,
  emptyState,
  loadState,
  STATE_FILE_NAME,
  saveState,
} from "./state.js";
import type { StateFile } from "./types.js";

const ROOT = path.resolve(path.sep, "sm-state");
const HASH = `sha256:${"a".repeat(64)}`;

const VALID_STATE: StateFile = {
  schemaVersion: 1,
  library: [
    {
      id: "sk_01H",
      name: "brainstorming",
      dirName: "brainstorming",
      contentHash: HASH,
      source: { type: "git", url: "https://example.com/skill.git", ref: "main", commit: "abc123" },
      license: "MIT",
      importedAt: "2026-11-05T00:00:00Z",
    },
  ],
  installations: [
    {
      skillId: "sk_01H",
      storeId: "~/.claude/skills",
      mode: "copy",
      installedHash: HASH,
      installedAt: "2026-11-05T00:00:00Z",
    },
  ],
  projects: [],
  settings: { sharedGroupMembers: [] },
};

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

class UnreadableFs extends MemoryFileSystem {
  override async readText(targetPath: string): Promise<FsResult<string>> {
    return fsErr("permission_denied", targetPath, "Tidak boleh dibaca (disimulasikan).");
  }
}

async function writeRawState(fs: MemoryFileSystem, dataRoot: string, raw: string): Promise<void> {
  ok(await fs.mkdir(dataRoot, { recursive: true }));
  ok(await fs.write(path.join(dataRoot, STATE_FILE_NAME), raw));
}

describe("loadState", () => {
  it("menganggap state kosong bila state.json belum ada", async () => {
    const fs = new MemoryFileSystem();
    const result = await loadState(fs, path.join(ROOT, "missing"));

    expect(result.status).toBe("missing");
    expect(result.state).toEqual(emptyState());
    expect(result.reason).toBeUndefined();
  });

  it("memuat state valid sesuai schema §9", async () => {
    const fs = new MemoryFileSystem();
    const dataRoot = path.join(ROOT, "valid");
    await writeRawState(fs, dataRoot, JSON.stringify(VALID_STATE));

    const result = await loadState(fs, dataRoot);

    expect(result.status).toBe("loaded");
    expect(result.state).toEqual(VALID_STATE);
  });

  it("menerima ketiga bentuk SourceInfo (folder, git, zip)", async () => {
    const fs = new MemoryFileSystem();
    const dataRoot = path.join(ROOT, "sumber");
    const baseSkill = {
      dirName: "skill",
      contentHash: HASH,
      license: "MIT",
      importedAt: "2026-11-05T00:00:00Z",
    };
    const state: StateFile = {
      ...emptyState(),
      library: [
        {
          ...baseSkill,
          id: "sk_folder",
          name: "folder",
          source: { type: "folder", path: "/tmp/a" },
        },
        {
          ...baseSkill,
          id: "sk_git",
          name: "git",
          source: { type: "git", url: "https://example.com/a.git", ref: "main", commit: "abc" },
        },
        { ...baseSkill, id: "sk_zip", name: "zip", source: { type: "zip", path: "/tmp/a.zip" } },
      ],
    };
    await writeRawState(fs, dataRoot, JSON.stringify(state));

    const result = await loadState(fs, dataRoot);

    expect(result.status).toBe("loaded");
    expect(result.state.library.map((skill) => skill.source.type)).toEqual([
      "folder",
      "git",
      "zip",
    ]);
  });

  it("pulih ke state kosong untuk JSON rusak dan melaporkan alasannya", async () => {
    const fs = new MemoryFileSystem();
    const dataRoot = path.join(ROOT, "json-rusak");
    await writeRawState(fs, dataRoot, "{ bukan json");

    const result = await loadState(fs, dataRoot);

    expect(result.status).toBe("recovered");
    expect(result.state).toEqual(emptyState());
    expect(result.reason).toContain("JSON");
  });

  it("pulih ke state kosong untuk schema tidak valid dan menyebut fieldnya", async () => {
    const fs = new MemoryFileSystem();
    const dataRoot = path.join(ROOT, "schema-rusak");
    await writeRawState(fs, dataRoot, JSON.stringify({ ...VALID_STATE, settings: {} }));

    const result = await loadState(fs, dataRoot);

    expect(result.status).toBe("recovered");
    expect(result.state).toEqual(emptyState());
    expect(result.reason).toContain("settings");
  });

  it("pulih dan melaporkan alasan bila file tidak bisa dibaca", async () => {
    const fs = new UnreadableFs();
    const result = await loadState(fs, path.join(ROOT, "tidak-terbaca"));

    expect(result.status).toBe("recovered");
    expect(result.state).toEqual(emptyState());
    expect(result.reason).toContain("permission_denied");
  });
});

describe("saveState", () => {
  it("menulis state.json secara atomik tanpa menyisakan .tmp", async () => {
    const fs = new MemoryFileSystem();
    const dataRoot = path.join(ROOT, "simpan");

    ok(await saveState(fs, dataRoot, VALID_STATE));

    const raw = ok(await fs.readText(path.join(dataRoot, STATE_FILE_NAME)));
    expect(JSON.parse(raw)).toEqual(VALID_STATE);
    expect(raw).toContain('"schemaVersion": 1');
    expect(ok(await fs.readdir(dataRoot))).toEqual([
      { name: STATE_FILE_NAME, kind: "file", isSymlink: false },
    ]);
  });

  it("round-trip save lalu load", async () => {
    const fs = new MemoryFileSystem();
    const dataRoot = path.join(ROOT, "roundtrip");

    ok(await saveState(fs, dataRoot, VALID_STATE));
    const result = await loadState(fs, dataRoot);

    expect(result.status).toBe("loaded");
    expect(result.state).toEqual(VALID_STATE);
  });

  it("bila rename gagal, state lama utuh dan .tmp dibersihkan", async () => {
    const fs = new RenameFailingFs();
    const dataRoot = path.join(ROOT, "gagal");
    ok(await fs.mkdir(dataRoot, { recursive: true }));
    ok(await fs.write(path.join(dataRoot, STATE_FILE_NAME), JSON.stringify(emptyState())));

    const result = await saveState(fs, dataRoot, VALID_STATE);

    expect(result).toMatchObject({ ok: false, error: { code: "io_error" } });
    const raw = ok(await fs.readText(path.join(dataRoot, STATE_FILE_NAME)));
    expect(JSON.parse(raw)).toEqual(emptyState());
    expect(ok(await fs.readdir(dataRoot))).toEqual([
      { name: STATE_FILE_NAME, kind: "file", isSymlink: false },
    ]);
  });

  it("melaporkan schemaVersion lebih baru sebagai unsupported_version", async () => {
    const fs = new MemoryFileSystem();
    const dataRoot = path.join(ROOT, "versi-baru");
    ok(await fs.mkdir(dataRoot, { recursive: true }));
    ok(
      await fs.write(
        path.join(dataRoot, STATE_FILE_NAME),
        JSON.stringify({ ...VALID_STATE, schemaVersion: 2 }),
      ),
    );

    const result = await loadState(fs, dataRoot);

    expect(result.status).toBe("unsupported_version");
    expect(result.reason).toContain("2");
    expect(result.state.library).toEqual([]);
  });

  it("mengarantina state korup ke state.json.corrupt sebelum menimpanya", async () => {
    const fs = new MemoryFileSystem();
    const dataRoot = path.join(ROOT, "korup");
    ok(await fs.mkdir(dataRoot, { recursive: true }));
    const korup = '{ "schemaVersion": 1, "library": [ BUKAN JSON }';
    ok(await fs.write(path.join(dataRoot, STATE_FILE_NAME), korup));

    ok(await saveState(fs, dataRoot, VALID_STATE));

    const quarantined = ok(await fs.readText(path.join(dataRoot, CORRUPT_STATE_FILE_NAME)));
    expect(quarantined).toBe(korup);

    const loaded = await loadState(fs, dataRoot);
    expect(loaded.status).toBe("loaded");
    expect(loaded.state).toEqual(VALID_STATE);
  });

  it("tidak mengarantina state lama yang masih valid", async () => {
    const fs = new MemoryFileSystem();
    const dataRoot = path.join(ROOT, "sehat");
    ok(await fs.mkdir(dataRoot, { recursive: true }));
    ok(await fs.write(path.join(dataRoot, STATE_FILE_NAME), JSON.stringify(emptyState())));

    ok(await saveState(fs, dataRoot, VALID_STATE));

    expect(await fs.exists(path.join(dataRoot, CORRUPT_STATE_FILE_NAME))).toBe(false);
  });

  it("mengganti .corrupt lama saat state korup berikutnya disimpan", async () => {
    const fs = new MemoryFileSystem();
    const dataRoot = path.join(ROOT, "korup-ganda");
    ok(await fs.mkdir(dataRoot, { recursive: true }));
    ok(await fs.write(path.join(dataRoot, CORRUPT_STATE_FILE_NAME), "sisa lama"));
    ok(await fs.write(path.join(dataRoot, STATE_FILE_NAME), "rusak lagi"));

    ok(await saveState(fs, dataRoot, VALID_STATE));

    const quarantined = ok(await fs.readText(path.join(dataRoot, CORRUPT_STATE_FILE_NAME)));
    expect(quarantined).toBe("rusak lagi");
  });
});
