import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { SkillManagerError } from "../core/errors.js";
import { createApp, handleAppError, SESSION_COOKIE } from "./app.js";

const TOKEN = "0123456789abcdef".repeat(4);
const HOST = "127.0.0.1";
const COOKIE = `sm_session=${TOKEN}`;
const WEB_ROOT = fileURLToPath(new URL("../web", import.meta.url));

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

interface TestRequestInit extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
  omitHost?: boolean;
}

function makeApp() {
  return createApp({ token: TOKEN, webRoot: WEB_ROOT });
}

async function request(path: string, init: TestRequestInit = {}): Promise<Response> {
  const { headers = {}, omitHost = false, ...rest } = init;
  const merged: Record<string, string> = { ...headers };
  if (!omitHost && !("Host" in merged)) {
    merged.Host = HOST;
  }
  return makeApp().request(`http://${HOST}${path}`, { ...rest, headers: merged });
}

async function errorBody(response: Response): Promise<ErrorBody> {
  return (await response.json()) as ErrorBody;
}

describe("penjaga Host", () => {
  const allowed = [
    "127.0.0.1",
    "127.0.0.1:1234",
    "localhost",
    "LOCALHOST",
    "localhost:3000",
    "[::1]",
    "[::1]:1234",
  ];

  it.each(allowed)("mengizinkan Host loopback %s", async (host) => {
    const response = await request("/api/health", {
      headers: { Host: host, Cookie: COOKIE },
    });

    expect(response.status).toBe(200);
  });

  const forbidden = [
    "evil.example",
    "evil.example:443",
    "localhost.",
    "localhost.:3000",
    "127.0.0.1.evil.com",
    "[::2]",
  ];

  it.each(forbidden)("menolak Host non-loopback %s dengan 403", async (host) => {
    const response = await request("/api/health", {
      headers: { Host: host, Cookie: COOKIE },
    });

    expect(response.status).toBe(403);
    expect((await errorBody(response)).error.code).toBe("forbidden");
  });

  const malformed = [
    "",
    "localhost:abc",
    "127.0.0.1:70000",
    "[::1",
    "[::1].evil.com",
    "::1",
    "127.0.0.1:12:34",
  ];

  it.each(malformed)("menolak Host malformed %j dengan 400", async (host) => {
    const response = await request("/api/health", {
      headers: { Host: host, Cookie: COOKIE },
    });

    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("bad_request");
  });

  it("menolak request tanpa header Host dengan 400", async () => {
    const response = await request("/api/health", { omitHost: true });

    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("bad_request");
  });
});

describe("sesi", () => {
  it("menolak request tanpa cookie sesi dengan 401", async () => {
    const response = await request("/api/health");

    expect(response.status).toBe(401);
    expect((await errorBody(response)).error.code).toBe("unauthorized");
  });
});

describe("tukar token", () => {
  it("menukar token valid menjadi cookie sesi httpOnly lalu redirect 302 tanpa token di URL", async () => {
    const response = await request(`/auth?token=${TOKEN}`);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("location")).not.toContain("token");

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE}=${TOKEN}`);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=strict");
    expect(setCookie.toLowerCase()).toContain("path=/");
  });

  it("menolak token yang salah dengan 401", async () => {
    const response = await request("/auth?token=token-palsu");

    expect(response.status).toBe(401);
    expect((await errorBody(response)).error.code).toBe("unauthorized");
  });

  it("cookie hasil /auth dipakai ulang untuk /api/health", async () => {
    const auth = await request(`/auth?token=${TOKEN}`);
    const cookie = (auth.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

    const health = await request("/api/health", { headers: { Cookie: cookie } });

    expect(health.status).toBe(200);
  });
});

describe("health", () => {
  it("mengembalikan ok dan version bila cookie sesi valid", async () => {
    const response = await request("/api/health", { headers: { Cookie: COOKIE } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, version: "0.1.0" });
  });

  it("membalas POST /api/health sebagai 404 JSON not_found", async () => {
    const response = await request("/api/health", {
      method: "POST",
      headers: { Cookie: COOKIE },
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect((await errorBody(response)).error.code).toBe("not_found");
  });
});

describe("notFound global", () => {
  it("mengembalikan 404 JSON untuk endpoint /api yang tidak dikenal", async () => {
    const response = await request("/api/tidak-ada", { headers: { Cookie: COOKIE } });

    expect(response.status).toBe(404);
    expect((await errorBody(response)).error.code).toBe("not_found");
  });

  it("mengembalikan 404 JSON untuk path non-API non-navigasi", async () => {
    const response = await request("/tidak-ada", { headers: { Cookie: COOKIE } });

    expect(response.status).toBe(404);
    expect((await errorBody(response)).error.code).toBe("not_found");
  });
});

describe("handler galat global", () => {
  it("memetakan SkillManagerError lewat code ke JSON dan status HTTP", async () => {
    const app = new Hono();
    app.onError(handleAppError);
    app.get("/gagal", () => {
      throw new SkillManagerError({
        code: "conflict",
        message: "Nama bentrok",
        details: { name: "brainstorming" },
      });
    });

    const response = await app.request("http://127.0.0.1/gagal", {
      headers: { Host: "127.0.0.1" },
    });

    expect(response.status).toBe(409);
    expect(await errorBody(response)).toEqual({
      error: { code: "conflict", message: "Nama bentrok", details: { name: "brainstorming" } },
    });
  });

  it("tidak membocorkan pesan/stack internal untuk error tak dikenal", async () => {
    const app = new Hono();
    app.onError(handleAppError);
    app.get("/gagal", () => {
      throw new Error("rahasia-jangan-bocor");
    });

    const response = await app.request("http://127.0.0.1/gagal", {
      headers: { Host: "127.0.0.1" },
    });

    expect(response.status).toBe(500);
    const body = await errorBody(response);
    expect(body.error.code).toBe("internal_error");
    expect(JSON.stringify(body)).not.toContain("rahasia-jangan-bocor");
  });
});
