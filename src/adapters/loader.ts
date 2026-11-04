import path from "node:path";
import type { ZodError } from "zod";
import { adaptersRoot } from "../core/paths.js";
import type { FileSystem } from "../fs/types.js";
import { BUNDLED_ADAPTERS } from "./bundled.js";
import { type Adapter, adapterSchema } from "./manifest.js";

/** Manifest pengguna yang dilewati, mis. karena tidak valid. */
export interface AdapterProblem {
  readonly file: string;
  readonly message: string;
}

export interface AdapterCatalog {
  readonly adapters: readonly Adapter[];
  /** Masalah manifest pengguna; manifest bawaan selalu ikut termuat. */
  readonly problems: readonly AdapterProblem[];
}

export interface LoadAdaptersOptions {
  readonly fs: FileSystem;
  readonly dataRoot: string;
  readonly platform?: NodeJS.Platform;
}

function platformPath(platform: NodeJS.Platform): path.PlatformPath {
  return platform === "win32" ? path.win32 : path.posix;
}

function formatIssues(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`)
    .join("; ");
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Manifest bawaan + manifest pengguna di dataRoot/adapters/*.json.
 *
 * Manifest pengguna menimpa manifest bawaan dengan id yang sama (spec §8).
 * Manifest pengguna yang tidak valid dilaporkan di problems dan dilewati;
 * satu file rusak tidak boleh menyembunyikan harness lain.
 */
export async function loadAdapters(options: LoadAdaptersOptions): Promise<AdapterCatalog> {
  const platform = options.platform ?? process.platform;
  const nodePath = platformPath(platform);
  const dir = adaptersRoot(options.dataRoot, platform);
  const problems: AdapterProblem[] = [];
  const adapters: Adapter[] = [...BUNDLED_ADAPTERS];

  const listing = await options.fs.readdir(dir);
  if (!listing.ok) {
    if (listing.error.code !== "not_found") {
      problems.push({ file: dir, message: listing.error.message });
    }
    return { adapters, problems };
  }

  const files = listing.value
    .filter((entry) => entry.kind === "file" && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  const overridden = new Set<string>();

  for (const name of files) {
    const file = nodePath.join(dir, name);
    const text = await options.fs.readText(file);
    if (!text.ok) {
      problems.push({ file, message: text.error.message });
      continue;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text.value);
    } catch (error) {
      problems.push({ file, message: `JSON tidak valid: ${describe(error)}` });
      continue;
    }

    const parsed = adapterSchema.safeParse(raw);
    if (!parsed.success) {
      problems.push({ file, message: formatIssues(parsed.error) });
      continue;
    }

    const adapter = parsed.data;
    if (overridden.has(adapter.id)) {
      problems.push({ file, message: `id "${adapter.id}" duplikat; manifest terakhir menang` });
    }
    overridden.add(adapter.id);

    const index = adapters.findIndex((existing) => existing.id === adapter.id);
    if (index >= 0) {
      adapters[index] = adapter;
    } else {
      adapters.push(adapter);
    }
  }

  return { adapters, problems };
}
