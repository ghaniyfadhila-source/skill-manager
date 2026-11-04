import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, SESSION_COOKIE } from "../../src/server/app.js";

const TOKEN = "fedcba9876543210".repeat(4);
const HOST = "127.0.0.1";
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;
const SECRET = "isi-rahasia-di-luar-web-root";

let parentDir = "";
let webRoot = "";

beforeEach(async () => {
  parentDir = await mkdtemp(join(tmpdir(), "skill-manager-web-"));
  webRoot = join(parentDir, "web");
  await mkdir(join(webRoot, "assets"), { recursive: true });
  await writeFile(join(webRoot, "index.html"), "<!doctype html><p>ui-uji</p>", "utf8");
  await writeFile(join(webRoot, "assets", "app.js"), "console.log('aset-uji');", "utf8");
  await writeFile(join(parentDir, "rahasia.txt"), SECRET, "utf8");
});

afterEach(async () => {
  await rm(parentDir, { recursive: true, force: true });
});

async function request(path: string, headers: Record<string, string> = {}): Promise<Response> {
  const app = createApp({ token: TOKEN, webRoot });
  return app.request(`http://${HOST}${path}`, {
    headers: {
      Host: HOST,
      Cookie: COOKIE,
      Accept: "text/html",
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

  it("menyajikan aset yang memang ada", async () => {
    const response = await request("/assets/app.js");

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("aset-uji");
  });

  it("memakai index.html sebagai fallback navigasi SPA", async () => {
    const response = await request("/skills/brainstorming", { Accept: "text/html" });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("ui-uji");
  });

  it("tidak memakai fallback SPA untuk request non-navigasi", async () => {
    const response = await request("/skills/brainstorming", { Accept: "application/json" });

    expect(response.status).toBe(404);
    expect(await response.text()).toContain('"code":"not_found"');
  });

  it("mengembalikan 404 JSON untuk aset yang hilang", async () => {
    const response = await request("/assets/nope.js");

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("tidak memakai fallback SPA untuk path ber-ekstensi", async () => {
    const response = await request("/skills/catatan.txt", { Accept: "text/html" });

    expect(response.status).toBe(404);
    expect(await response.text()).toContain('"code":"not_found"');
  });

  it("mengembalikan 404 JSON untuk endpoint /api yang tidak dikenal", async () => {
    const response = await request("/api/tidak-ada");

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });
});

describe("traversal", () => {
  const traversalPaths = [
    "/..%2frahasia.txt",
    "/%2e%2e%2frahasia.txt",
    "/..%5crahasia.txt",
    "/%2e%2e/%2e%2e/rahasia.txt",
    "/../rahasia.txt",
    "//etc/passwd",
  ];

  it.each(traversalPaths)("tidak membocorkan file luar web root untuk %s", async (path) => {
    const response = await request(path);
    const text = await response.text();
    const contentType = response.headers.get("content-type") ?? "";

    expect(text).not.toContain(SECRET);
    expect([200, 404]).toContain(response.status);
    if (contentType.includes("json")) {
      expect(text).toContain('"code":"not_found"');
    } else {
      expect(text).toContain("ui-uji");
    }
  });
});
