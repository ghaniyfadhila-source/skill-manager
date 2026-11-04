import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, SESSION_COOKIE } from "../../src/server/app.js";

const TOKEN = "fedcba9876543210".repeat(4);
const HOST = "127.0.0.1";

let webRoot: string;

beforeEach(async () => {
  webRoot = await mkdtemp(join(tmpdir(), "skill-manager-web-"));
  await writeFile(join(webRoot, "index.html"), "<!doctype html><p>ui-uji</p>", "utf8");
});

afterEach(async () => {
  await rm(webRoot, { recursive: true, force: true });
});

async function request(path: string, headers: Record<string, string> = {}): Promise<Response> {
  const app = createApp({ token: TOKEN, webRoot });
  return app.request(`http://${HOST}${path}`, {
    headers: {
      Host: HOST,
      Cookie: `${SESSION_COOKIE}=${TOKEN}`,
      ...headers,
    },
  });
}

describe("UI statis", () => {
  it("menyajikan index.html dari direktori web", async () => {
    const response = await request("/");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("ui-uji");
  });

  it("memakai index.html sebagai fallback route SPA", async () => {
    const response = await request("/skills/brainstorming");

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("ui-uji");
  });

  it("mengembalikan 404 JSON untuk endpoint /api yang tidak dikenal", async () => {
    const response = await request("/api/tidak-ada");

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });
});
