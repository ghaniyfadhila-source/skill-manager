import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createApp, SESSION_COOKIE } from "./app.js";

const TOKEN = "0123456789abcdef".repeat(4);
const HOST = "127.0.0.1";
const COOKIE = `sm_session=${TOKEN}`;
const WEB_ROOT = fileURLToPath(new URL("../web", import.meta.url));

interface ErrorResponse {
  error: { code: string; message?: string };
}

interface TestRequestInit extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
}

function makeApp() {
  return createApp({ token: TOKEN, webRoot: WEB_ROOT });
}

async function request(path: string, init: TestRequestInit = {}): Promise<Response> {
  const { headers = {}, ...rest } = init;
  return makeApp().request(`http://${HOST}${path}`, {
    ...rest,
    headers: { Host: HOST, ...headers },
  });
}

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as ErrorResponse;
  return body.error.code;
}

describe("penjaga Host", () => {
  it("menolak request dengan header Host bukan loopback dengan 403", async () => {
    const response = await request("/api/health", { headers: { Host: "evil.example:4321" } });

    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("forbidden");
  });
});

describe("sesi", () => {
  it("menolak request tanpa cookie sesi dengan 401", async () => {
    const response = await request("/api/health");

    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("unauthorized");
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
    expect(await errorCode(response)).toBe("unauthorized");
  });
});

describe("health", () => {
  it("mengembalikan ok dan version bila cookie sesi valid", async () => {
    const response = await request("/api/health", { headers: { Cookie: COOKIE } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, version: "0.1.0" });
  });
});
