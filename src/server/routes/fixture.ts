import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import type { Hono } from "hono";
import { contentHash } from "../../core/hash.js";
import { libraryRoot, statePath } from "../../core/paths.js";
import { loadState, saveState } from "../../core/state.js";
import type { Skill } from "../../core/types.js";
import { MemoryFileSystem } from "../../fs/memory.js";
import { FakeProcessRunner } from "../../fs/process-fake.js";
import type { FsResult } from "../../fs/types.js";
import { createApp } from "../app.js";

/** Fixture bersama test route API: tanpa disk asli, tanpa jaringan, tanpa proses. */
export const TOKEN = "0123456789abcdef".repeat(4);
export const HOST = "127.0.0.1";
export const COOKIE = `sm_session=${TOKEN}`;
export const HOME = path.resolve(path.sep, "sm-server-home");
export const DATA_ROOT = path.resolve(path.sep, "sm-server-data");
export const LIBRARY = libraryRoot(DATA_ROOT);
export const SKILL_NAME = "brainstorming";

const WEB_ROOT = fileURLToPath(new URL("../../web", import.meta.url));

export function ok<T>(result: FsResult<T>): T {
  if (!result.ok) {
    throw new Error(`Operasi gagal: ${result.error.code} — ${result.error.message}`);
  }
  return result.value;
}

export interface RequestOptions extends Omit<RequestInit, "headers"> {
  readonly headers?: Record<string, string>;
  readonly omitCookie?: boolean;
  readonly omitHost?: boolean;
}

export interface TestServer {
  readonly fs: MemoryFileSystem;
  readonly runner: FakeProcessRunner;
  readonly app: Hono;
  request(target: string, options?: RequestOptions): Promise<Response>;
}

export function createTestServer(options: { readonly fs?: MemoryFileSystem } = {}): TestServer {
  const fs = options.fs ?? new MemoryFileSystem();
  const runner = new FakeProcessRunner();
  const app = createApp({
    token: TOKEN,
    webRoot: WEB_ROOT,
    deps: { fs, runner, dataRoot: DATA_ROOT, home: HOME },
  });

  return {
    fs,
    runner,
    app,
    request: async (target, init = {}) => {
      const { headers = {}, omitCookie = false, omitHost = false, ...rest } = init;
      const merged: Record<string, string> = { ...headers };
      if (!omitHost && !("Host" in merged)) {
        merged.Host = HOST;
      }
      if (!omitCookie && !("Cookie" in merged)) {
        merged.Cookie = COOKIE;
      }
      return app.request(`http://${HOST}${target}`, { ...rest, headers: merged });
    },
  };
}

/** Kirim body JSON sebagai objek; tanpa double-encode. */
export function jsonRequest(
  server: TestServer,
  target: string,
  method: "POST" | "DELETE",
  body: unknown,
  options: RequestOptions = {},
): Promise<Response> {
  return server.request(target, {
    ...options,
    method,
    headers: { "Content-Type": "application/json", ...options.headers },
    body: JSON.stringify(body),
  });
}

export interface SeedOptions {
  readonly name?: string;
  readonly files?: Record<string, string>;
}

/** Tulis isi skill ke Library dan catat entrinya di state.json. */
export async function seedSkill(fs: MemoryFileSystem, options: SeedOptions = {}): Promise<Skill> {
  const name = options.name ?? SKILL_NAME;
  const files = options.files ?? { "SKILL.md": `# ${name}\n`, "references/tips.md": "tips\n" };
  const source = path.join(LIBRARY, name);
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(source, ...relative.split("/"));
    ok(await fs.mkdir(path.dirname(target), { recursive: true }));
    ok(await fs.write(target, content));
  }

  const skill: Skill = {
    id: `sk_${name}`,
    name,
    dirName: name,
    contentHash: ok(await contentHash(fs, source)),
    source: { type: "folder", path: path.join(HOME, "asal", name) },
    importedAt: "2026-11-05T00:00:00Z",
  };

  const loaded = await loadState(fs, DATA_ROOT);
  ok(
    await saveState(fs, DATA_ROOT, { ...loaded.state, library: [...loaded.state.library, skill] }),
  );
  return skill;
}

/** Tulis state.json mentah (mis. versi skema yang lebih baru). */
export async function writeRawState(fs: MemoryFileSystem, content: unknown): Promise<void> {
  ok(await fs.mkdir(DATA_ROOT, { recursive: true }));
  ok(await fs.write(statePath(DATA_ROOT), JSON.stringify(content, null, 2)));
}

export function storePath(harness: string): string {
  switch (harness) {
    case "claude-code":
      return path.join(HOME, ".claude", "skills");
    case "opencode":
      return path.join(HOME, ".config", "opencode", "skills");
    case "antigravity":
      return path.join(HOME, ".gemini", "config", "skills");
    default:
      return path.join(HOME, ".agents", "skills");
  }
}
/** Folder sumber di luar Library, untuk menguji pratinjau dan impor. */
export const SOURCE_ROOT = path.join(HOME, "sources");

export async function createSourceFolder(
  fs: MemoryFileSystem,
  name: string,
  files: Record<string, string> = { "SKILL.md": `---\nname: ${name}\n---\n# ${name}\n` },
): Promise<string> {
  const root = path.join(SOURCE_ROOT, name);
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, ...relative.split("/"));
    ok(await fs.mkdir(path.dirname(target), { recursive: true }));
    ok(await fs.write(target, content));
  }
  return root;
}

interface ZipSeed {
  readonly name: string;
  readonly data?: string;
}

/** Penulis zip minimal (entri stored) untuk menguji jalur impor zip lewat HTTP. */
export function makeZipBytes(seeds: readonly ZipSeed[]): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const seed of seeds) {
    const name = Buffer.from(seed.name, "utf8");
    const data = Buffer.from(seed.data ?? "");
    const flags = 0x800;
    const mode = seed.name.endsWith("/") ? 0o040755 : 0o100644;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE((3 << 8) | 20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(flags, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt32LE(crc32(data), 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE((mode << 16) >>> 0, 38);
    entry.writeUInt32LE(offset, 42);

    parts.push(local, name, data);
    central.push(entry, name);
    offset += 30 + name.length + data.length;
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
