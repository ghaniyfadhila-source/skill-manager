import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import packageJson from "../../package.json" with { type: "json" };

export interface AppOptions {
  /** Token sesi yang dibuat sekali per proses server. */
  token: string;
  /** Direktori hasil build UI (dist/web). */
  webRoot: string;
}

export const SESSION_COOKIE = "sm_session";
export const APP_VERSION: string = packageJson.version;

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

function tokensMatch(given: string, expected: string): boolean {
  const givenBuffer = Buffer.from(given);
  const expectedBuffer = Buffer.from(expected);
  if (givenBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(givenBuffer, expectedBuffer);
}

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

/**
 * Header Host hanya boleh menunjuk ke loopback. Ini menutup DNS rebinding:
 * halaman asing yang resolve ke 127.0.0.1 tetap membawa Host miliknya sendiri.
 */
export function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) {
    return false;
  }

  const value = hostHeader.trim().toLowerCase();
  if (!value) {
    return false;
  }

  let hostname: string;
  if (value.startsWith("[")) {
    const closingBracket = value.indexOf("]");
    if (closingBracket === -1) {
      return false;
    }
    hostname = value.slice(1, closingBracket);
    const remainder = value.slice(closingBracket + 1);
    if (remainder && !/^:\d+$/.test(remainder)) {
      return false;
    }
  } else {
    const parts = value.split(":");
    if (parts.length > 2) {
      return false;
    }
    hostname = parts[0] ?? "";
    const port = parts[1];
    if (port !== undefined && !/^\d+$/.test(port)) {
      return false;
    }
  }

  return LOOPBACK_HOSTNAMES.has(hostname);
}

export function createApp(options: AppOptions): Hono {
  const app = new Hono();

  app.use("*", async (c, next) => {
    if (!isLoopbackHost(c.req.header("host"))) {
      return c.json(
        errorBody("forbidden", "Header Host harus menunjuk ke 127.0.0.1 atau localhost."),
        403,
      );
    }
    await next();
  });

  app.get("/auth", (c) => {
    const candidate = c.req.query("token");
    if (!candidate || !tokensMatch(candidate, options.token)) {
      return c.json(errorBody("unauthorized", "Token tidak valid."), 401);
    }

    setCookie(c, SESSION_COOKIE, options.token, {
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
    });
    c.header("Cache-Control", "no-store");
    return c.redirect("/", 302);
  });

  app.use("*", async (c, next) => {
    const session = getCookie(c, SESSION_COOKIE);
    if (!session || !tokensMatch(session, options.token)) {
      return c.json(
        errorBody("unauthorized", "Sesi tidak valid. Buka URL ber-token yang dicetak server."),
        401,
      );
    }
    await next();
  });

  app.get("/api/health", (c) => c.json({ ok: true, version: APP_VERSION }));

  app.use("*", serveStatic({ root: options.webRoot }));

  app.all("*", async (c) => {
    if (c.req.path.startsWith("/api/")) {
      return c.json(errorBody("not_found", `Endpoint ${c.req.path} tidak ditemukan.`), 404);
    }
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      return c.json(errorBody("method_not_allowed", "Metode tidak didukung."), 405);
    }
    try {
      const html = await readFile(join(options.webRoot, "index.html"), "utf8");
      return c.html(html);
    } catch {
      return c.json(
        errorBody("web_not_built", "UI belum dibangun. Jalankan `pnpm run build` lebih dulu."),
        404,
      );
    }
  });

  return app;
}
