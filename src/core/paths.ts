import { homedir as osHomedir } from "node:os";
import path from "node:path";

/** Override data root; wajib dipakai test agar tidak menyentuh home asli. */
export const DATA_ROOT_ENV = "SKILL_MANAGER_DATA_ROOT";

export interface DataRootOptions {
  /** Default `process.env`. */
  readonly env?: Record<string, string | undefined>;
  /** Default `process.platform`. */
  readonly platform?: NodeJS.Platform;
  /** Default `os.homedir()`; bisa disuntikkan test. */
  readonly homedir?: string;
}

/** Path flavor sesuai platform; dipakai modul lain agar pemisah path benar di test. */
export function platformPath(platform: NodeJS.Platform): path.PlatformPath {
  return platform === "win32" ? path.win32 : path.posix;
}

/**
 * Data root v0.1 (kontrak §5):
 * - Windows: `%LOCALAPPDATA%\SkillManager`
 * - Linux: `${XDG_DATA_HOME:-~/.local/share}/skillmanager`
 * - Override: `SKILL_MANAGER_DATA_ROOT`
 *
 * Platform selain win32 mengikuti aturan XDG; v0.1 hanya mendukung Windows dan
 * Linux, jadi fallback ini tidak menambah dukungan macOS secara resmi.
 */
export function resolveDataRoot(options: DataRootOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const nodePath = platformPath(platform);
  const override = env[DATA_ROOT_ENV]?.trim();
  if (override) {
    return nodePath.resolve(override);
  }

  const home = options.homedir ?? osHomedir();
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim() || nodePath.join(home, "AppData", "Local");
    return nodePath.join(localAppData, "SkillManager");
  }

  const dataHome = env.XDG_DATA_HOME?.trim() || nodePath.join(home, ".local", "share");
  return nodePath.join(dataHome, "skillmanager");
}

/**
 * Helper turunan data root. `platform` bisa disuntikkan agar test bisa
 * memeriksa bentuk path Windows di Linux (dan sebaliknya) tanpa salah
 * pemisah path.
 */
export function libraryRoot(
  dataRoot: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platformPath(platform).join(dataRoot, "library");
}

export function adaptersRoot(
  dataRoot: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platformPath(platform).join(dataRoot, "adapters");
}

export function depsRoot(dataRoot: string, platform: NodeJS.Platform = process.platform): string {
  return platformPath(platform).join(dataRoot, "deps");
}

export function statePath(dataRoot: string, platform: NodeJS.Platform = process.platform): string {
  return platformPath(platform).join(dataRoot, "state.json");
}
