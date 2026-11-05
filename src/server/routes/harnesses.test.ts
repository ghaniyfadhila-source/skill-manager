import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTestServer, HOME } from "./fixture.js";

interface HarnessBody {
  id: string;
  name: string;
  capability: string;
  detected: boolean;
  detectionReasons: string[];
  storeIds?: string[];
  targets?: { id: string; harnessId: string; scope: string; storeId: string }[];
  connect?: { installUrl: string };
}

async function harnesses(server: ReturnType<typeof createTestServer>): Promise<HarnessBody[]> {
  const response = await server.request("/api/harnesses");
  expect(response.status).toBe(200);
  const body = (await response.json()) as { harnesses: HarnessBody[] };
  return body.harnesses;
}

function byId(list: readonly HarnessBody[], id: string): HarnessBody {
  const found = list.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new Error(`Harness "${id}" tidak ada di respons.`);
  }
  return found;
}

describe("GET /api/harnesses", () => {
  it("mengembalikan harness managed beserta Target-nya", async () => {
    const server = createTestServer();

    const list = await harnesses(server);

    const claude = byId(list, "claude-code");
    expect(claude).toMatchObject({
      id: "claude-code",
      name: "[CC]",
      capability: "managed",
      detected: false,
      storeIds: ["~/.claude/skills"],
    });
    expect(claude.detectionReasons.length).toBeGreaterThan(0);
    expect(claude.targets).toEqual([
      {
        id: "claude-code/global",
        harnessId: "claude-code",
        scope: "global",
        storeId: "~/.claude/skills",
      },
    ]);
    expect(claude.connect?.installUrl).toMatch(/^https:\/\//);
  });

  it("menyertakan harness detected-only tanpa Target", async () => {
    const list = await harnesses(createTestServer());

    const goose = byId(list, "goose");
    expect(goose.capability).toBe("detected");
    expect(goose.targets).toEqual([]);
    expect(goose.storeIds).toEqual([]);
  });

  it("menandai harness terdeteksi bila path-nya ada, tanpa menjalankan proses", async () => {
    const server = createTestServer();
    ok(await server.fs.mkdir(path.join(HOME, ".claude"), { recursive: true }));

    const claude = byId(await harnesses(server), "claude-code");

    expect(claude.detected).toBe(true);
    expect(server.runner.calls).toEqual([]);
  });

  it("menolak GET /api/harnesses/recheck dengan 404 JSON", async () => {
    const response = await createTestServer().request("/api/harnesses/recheck");

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("not_found");
  });
});

describe("POST /api/harnesses/recheck", () => {
  it("mendeteksi ulang harness yang baru muncul tanpa restart", async () => {
    const server = createTestServer();
    expect(byId(await harnesses(server), "claude-code").detected).toBe(false);

    ok(await server.fs.mkdir(path.join(HOME, ".claude"), { recursive: true }));
    const response = await server.request("/api/harnesses/recheck", { method: "POST" });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { harnesses: HarnessBody[] };
    expect(byId(body.harnesses, "claude-code").detected).toBe(true);
  });

  it("tidak menjalankan proses apa pun saat tidak ada binary di PATH", async () => {
    const server = createTestServer();

    await server.request("/api/harnesses/recheck", { method: "POST" });

    expect(server.runner.calls).toEqual([]);
  });
});

function ok<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) {
    throw new Error("Operasi fixture gagal.");
  }
  return result.value;
}
