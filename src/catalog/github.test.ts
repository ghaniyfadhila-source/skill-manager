import { describe, expect, it } from "vitest";
import { enrichCatalog } from "./github.js";
import type { CatalogSeed } from "./seed.js";

const SEED = [
  { owner: "anthropics", repo: "skills", subdir: "skills/docx", name: "docx", description: "d" },
  { owner: "anthropics", repo: "skills", subdir: "skills/pdf", name: "pdf", description: "p" },
  {
    owner: "obra",
    repo: "superpowers",
    subdir: "skills/writing-plans",
    name: "writing-plans",
    description: "w",
  },
] satisfies readonly CatalogSeed[];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("enrichCatalog", () => {
  it("menambah bintang live dan memakai deskripsi kurasi", async () => {
    const calls: string[] = [];
    const fetcher = async (url: string): Promise<Response> => {
      calls.push(url);
      return url.includes("anthropics/skills")
        ? jsonResponse({ stargazers_count: 191456 })
        : jsonResponse({ stargazers_count: 315314 });
    };

    const items = await enrichCatalog(SEED, fetcher);

    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      name: "docx",
      owner: "anthropics",
      repo: "skills",
      subdir: "skills/docx",
      description: "d",
      stars: 191456,
    });
    expect(items[2]?.stars).toBe(315314);
    // Satu panggilan per repo unik, bukan per entri.
    expect(calls).toHaveLength(2);
  });

  it("menghilangkan bintang (bukan menggagalkan) saat fetch error", async () => {
    const fetcher = async (): Promise<Response> => {
      throw new Error("jaringan mati");
    };

    const items = await enrichCatalog(SEED, fetcher);

    expect(items.every((item) => item.stars === undefined)).toBe(true);
    expect(items.map((item) => item.name)).toEqual(["docx", "pdf", "writing-plans"]);
  });

  it("mengabaikan bintang pada respons GitHub yang gagal (rate-limit)", async () => {
    const fetcher = async (): Promise<Response> => new Response("rate limited", { status: 403 });

    const items = await enrichCatalog(SEED, fetcher);

    expect(items[0]?.stars).toBeUndefined();
  });
});
