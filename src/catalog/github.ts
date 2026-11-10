/**
 * Metadata hidup katalog: jumlah bintang dari GitHub API.
 *
 * "Terpercaya" datang dari allowlist (`seed.ts`), "tren" dari bintang yang
 * di-fetch saat request. Fetch gagal/rate-limit cukup membuat `stars` hilang —
 * katalog tetap tampil dari data seed. Fetch disuntikkan supaya unit test
 * tidak menyentuh jaringan.
 */
import type { CatalogSeed } from "./seed.js";

/** Bentuk item yang dikirim server ke UI. */
export interface CatalogItem {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly owner: string;
  readonly repo: string;
  readonly subdir: string;
  readonly url: string;
  readonly stars?: number;
}

export type CatalogFetcher = (url: string) => Promise<Response>;

async function repoStars(
  fetcher: CatalogFetcher,
  owner: string,
  repo: string,
): Promise<number | undefined> {
  try {
    const response = await fetcher(`https://api.github.com/repos/${owner}/${repo}`);
    if (!response.ok) {
      return undefined;
    }
    const data = (await response.json()) as { readonly stargazers_count?: unknown };
    return typeof data.stargazers_count === "number" ? data.stargazers_count : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Gabungkan allowlist dengan bintang hidup. Satu panggilan per repo unik, dan
 * kegagalan per repo tidak menggagalkan yang lain.
 */
export async function enrichCatalog(
  seed: readonly CatalogSeed[],
  fetcher: CatalogFetcher,
): Promise<readonly CatalogItem[]> {
  const starsByRepo = new Map<string, number | undefined>();
  const items: CatalogItem[] = [];

  for (const entry of seed) {
    const repoKey = `${entry.owner}/${entry.repo}`;
    if (!starsByRepo.has(repoKey)) {
      starsByRepo.set(repoKey, await repoStars(fetcher, entry.owner, entry.repo));
    }
    const stars = starsByRepo.get(repoKey);
    items.push({
      id: `${entry.owner}/${entry.repo}/${entry.name}`,
      name: entry.name,
      description: entry.description,
      owner: entry.owner,
      repo: entry.repo,
      subdir: entry.subdir,
      url: `https://github.com/${entry.owner}/${entry.repo}`,
      ...(stars === undefined ? {} : { stars }),
    });
  }
  return items;
}
