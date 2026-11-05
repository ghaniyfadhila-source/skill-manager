import { homedir } from "node:os";
import path from "node:path";
import type { Harness } from "../core/types.js";
import { DEFAULT_PROCESS_TIMEOUT_MS, type ProcessRunner } from "../fs/process.js";
import type { FileSystem } from "../fs/types.js";
import { expandHome, platformPath } from "./home.js";
import { type AdapterCatalog, type AdapterProblem, loadAdapters } from "./loader.js";
import { type Adapter, adapterCapability } from "./manifest.js";

/** Direktori kandidat di luar PATH (spec §10.1: PATH + direktori kandidat). */
const POSIX_CANDIDATES = ["/usr/local/bin", "/usr/bin", "/bin"];

export interface DetectOptions {
  readonly fs: FileSystem;
  readonly runner: ProcessRunner;
  /** Default os.homedir(); test menyuntikkan home buatan. */
  readonly home?: string;
  /** Default process.env; dipakai untuk PATH dan direktori kandidat. */
  readonly env?: Record<string, string | undefined>;
  readonly platform?: NodeJS.Platform;
  /** Batas waktu verifikasi binary; default 5000 ms (kontrak §2, spec §10.1). */
  readonly timeoutMs?: number;
}

export interface RecheckOptions extends DetectOptions {
  readonly dataRoot: string;
}

export interface RecheckResult {
  readonly adapters: readonly Adapter[];
  readonly harnesses: readonly Harness[];
  readonly problems: readonly AdapterProblem[];
}

interface DetectContext {
  readonly fs: FileSystem;
  readonly runner: ProcessRunner;
  readonly home: string;
  readonly env: Record<string, string | undefined>;
  readonly platform: NodeJS.Platform;
  readonly nodePath: ReturnType<typeof platformPath>;
  readonly timeoutMs: number;
  readonly searchDirs: readonly string[];
}

function splitList(value: string, separator: string): string[] {
  return value
    .split(separator)
    .map((entry) => entry.trim().replace(/^"|"$/g, ""))
    .filter((entry) => entry.length > 0);
}

function candidateDirs(context: Omit<DetectContext, "searchDirs">): string[] {
  const { env, home, nodePath, platform } = context;
  if (platform === "win32") {
    const appData = env.APPDATA?.trim() || nodePath.join(home, "AppData", "Roaming");
    const localAppData = env.LOCALAPPDATA?.trim() || nodePath.join(home, "AppData", "Local");
    return [
      nodePath.join(appData, "npm"),
      nodePath.join(localAppData, "Programs"),
      nodePath.join(home, ".local", "bin"),
    ];
  }
  return [...POSIX_CANDIDATES, nodePath.join(home, ".local", "bin"), nodePath.join(home, "bin")];
}

function createContext(options: DetectOptions): DetectContext {
  const platform = options.platform ?? process.platform;
  const base = {
    fs: options.fs,
    runner: options.runner,
    home: options.home ?? homedir(),
    env: options.env ?? process.env,
    platform,
    nodePath: platformPath(platform),
    timeoutMs: options.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS,
  };

  const rawPath = base.env.PATH ?? base.env.Path ?? base.env.path ?? "";
  const fromPath = splitList(rawPath, platform === "win32" ? ";" : ":");
  const seen = new Set<string>();
  const searchDirs: string[] = [];
  for (const dir of [...fromPath, ...candidateDirs(base)]) {
    const resolved = base.nodePath.resolve(dir);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    searchDirs.push(resolved);
  }

  return { ...base, searchDirs };
}

async function isFile(fs: FileSystem, target: string): Promise<boolean> {
  const stat = await fs.stat(target);
  return stat.ok && stat.value.kind === "file";
}

function binaryNames(binary: string, platform: NodeJS.Platform): string[] {
  if (platform !== "win32") {
    return [binary];
  }
  return [`${binary}.exe`, `${binary}.cmd`, `${binary}.bat`, binary, `${binary}.ps1`];
}

async function findBinary(context: DetectContext, binary: string): Promise<string | undefined> {
  for (const dir of context.searchDirs) {
    for (const name of binaryNames(binary, context.platform)) {
      const candidate = context.nodePath.join(dir, name);
      if (await isFile(context.fs, candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

/**
 * Verifikasi binary dengan argumen versi (default --version) dan timeout 5 detik.
 * Kegagalan di sini tidak membatalkan deteksi: hasilnya hanya alasan tambahan.
 */
async function verifyBinary(
  context: DetectContext,
  binary: string,
  command: string,
  versionArgs: readonly string[],
): Promise<string> {
  if (versionArgs.length === 0) {
    return `${binary} ditemukan`;
  }

  // Shim `.cmd`/`.bat`/`.ps1` adalah skrip shell, bukan executable. Node
  // menolak menjalankannya tanpa `shell: true` (CVE-2024-27980), dan memakai
  // shell di sini berarti argumen ikut diinterpolasi. Binary-nya tetap
  // dilaporkan ditemukan; hanya verifikasi versinya yang dilewati.
  if (context.platform === "win32" && /\.(cmd|bat|ps1)$/i.test(command)) {
    return `${binary} ditemukan (skrip ${path.win32.extname(command).slice(1)}, versi tidak diverifikasi)`;
  }

  const label = `${binary} ${versionArgs.join(" ")}`;
  const result = await context.runner.run(command, versionArgs, { timeoutMs: context.timeoutMs });
  if (!result.ok) {
    return `${label} gagal dijalankan (${result.error.code})`;
  }
  if (result.value.timedOut) {
    return `${label} tidak menjawab dalam ${context.timeoutMs} ms`;
  }
  if (result.value.code === 0) {
    return `${label} menjawab`;
  }
  return `${label} keluar dengan kode ${result.value.code ?? "?"}`;
}

async function detectOne(adapter: Adapter, context: DetectContext): Promise<Harness> {
  const reasons: string[] = [];
  let detected = false;

  for (const raw of adapter.detect.paths) {
    const resolved = expandHome(raw, context.home, context.platform);
    const stat = await context.fs.stat(resolved);
    if (stat.ok) {
      detected = true;
      reasons.push(`ditemukan ${raw}`);
      continue;
    }
    reasons.push(`${raw} tidak ada`);
  }

  for (const binary of adapter.detect.binaries) {
    const command = await findBinary(context, binary);
    if (command === undefined) {
      reasons.push(`${binary} tidak ditemukan di PATH`);
      continue;
    }
    detected = true;
    reasons.push(await verifyBinary(context, binary, command, adapter.detect.versionArgs));
  }

  const capability = adapterCapability(adapter);
  if (adapter.tier === "detected-only") {
    reasons.push(
      "adapter berstatus detected-only: terlihat di UI, tidak bisa dipilih sebagai Target",
    );
  } else if (adapter.verified === undefined) {
    reasons.push("manifest tidak punya verified.at: status diturunkan ke detected");
  }
  if (adapter.notes !== undefined) {
    reasons.push(adapter.notes);
  }

  return {
    id: adapter.id,
    name: adapter.name,
    capability,
    detected,
    detectionReasons: reasons,
    storeIds: capability === "managed" ? adapter.stores.map((store) => store.path) : [],
    connect: adapter.connect === undefined ? undefined : { installUrl: adapter.connect.installUrl },
  };
}

/** Deteksi semua harness: cek path, cari binary, verifikasi --version (spec §10.1). */
export async function detectHarnesses(
  adapters: readonly Adapter[],
  options: DetectOptions,
): Promise<Harness[]> {
  const context = createContext(options);
  const harnesses: Harness[] = [];
  for (const adapter of adapters) {
    harnesses.push(await detectOne(adapter, context));
  }
  return harnesses;
}

/**
 * Tombol Recheck (spec §10.1 langkah 5): baca ulang manifest bawaan + pengguna
 * lalu deteksi lagi, tanpa restart. Harness yang dipasang setelah app berjalan
 * muncul di hasil ini.
 */
export async function recheck(options: RecheckOptions): Promise<RecheckResult> {
  const catalog: AdapterCatalog = await loadAdapters(options);
  const harnesses = await detectHarnesses(catalog.adapters, options);
  return { adapters: catalog.adapters, harnesses, problems: catalog.problems };
}
