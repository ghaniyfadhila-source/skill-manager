import { platformPath } from "../core/paths.js";

// Satu implementasi saja: flavors path ada di core/paths.ts.
export { platformPath };

/**
 * Ekspansi awalan "~" pada path manifest (spec §10.1). Hanya awalan yang
 * diekspansi; path absolut dibiarkan apa adanya.
 */
export function expandHome(raw: string, home: string, platform: NodeJS.Platform): string {
  const nodePath = platformPath(platform);
  if (raw === "~") {
    return nodePath.resolve(home);
  }
  if (raw.startsWith("~/") || raw.startsWith("~\\")) {
    return nodePath.resolve(home, raw.slice(2));
  }
  return raw;
}
