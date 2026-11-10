import { describe, expect, it } from "vitest";
import { createTestServer, seedSkill } from "./fixture.js";

function starsFor(url: string): number {
  if (url.includes("anthropics/skills")) {
    return 191456;
  }
  if (url.includes("obra/superpowers")) {
    return 315314;
  }
  return 42373;
}

function fakeFetch(url: string): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify({ stargazers_count: starsFor(url) }), { status: 200 }),
  );
}

describe("GET /api/catalog", () => {
  it("mengembalikan daftar skill dengan bintang live", async () => {
    const server = createTestServer({ fetch: fakeFetch });

    const response = await server.request("/api/catalog");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: { name: string; owner: string; subdir: string; stars?: number; installed: boolean }[];
    };

    expect(body.items.length).toBeGreaterThan(0);
    const docx = body.items.find((item) => item.name === "docx");
    expect(docx).toMatchObject({ owner: "anthropics", subdir: "skills/docx", stars: 191456 });
    expect(docx?.installed).toBe(false);
  });

  it("menandai skill yang sudah ada di Library sebagai installed", async () => {
    const server = createTestServer({ fetch: fakeFetch });
    await seedSkill(server.fs, { name: "docx" });

    const response = await server.request("/api/catalog");
    const body = (await response.json()) as {
      items: { name: string; installed: boolean }[];
    };

    expect(body.items.find((item) => item.name === "docx")?.installed).toBe(true);
  });

  it("tetap menjawab meski GitHub tidak bisa dihubungi", async () => {
    const server = createTestServer({
      fetch: () => Promise.reject(new Error("offline")),
    });

    const response = await server.request("/api/catalog");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: { stars?: number }[] };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((item) => item.stars === undefined)).toBe(true);
  });
});
