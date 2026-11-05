import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import packageJson from "../../package.json" with { type: "json" };
import { SkillManagerError } from "../core/errors.js";
import { resolveDataRoot } from "../core/paths.js";
import { NodeFileSystem } from "../fs/node.js";
import { NodeProcessRunner } from "../fs/process-node.js";
import { registerConnectRoutes } from "./routes/connect.js";
import type { ServerDeps } from "./routes/context.js";
import { registerDepsRoutes } from "./routes/deps.js";
import { registerDoctorRoutes } from "./routes/doctor.js";
import { registerHarnessRoutes } from "./routes/harnesses.js";
import { registerInstallationRoutes } from "./routes/installations.js";
import { registerSkillRoutes } from "./routes/skills.js";
import { registerSyncRoutes } from "./routes/sync.js";

export interface AppOptions {
  /** Token sesi yang dibuat sekali per proses server. */
  token: string;
  /** Direktori hasil build UI (dist/web). */
  webRoot: string;
  /**
   * Dependensi domain. Produksi memakai implementasi Node + data root asli;
   * test menyuntikkan MemoryFileSystem/FakeProcessRunner dan dataRoot sementara.
   */
  deps?: ServerDeps;
}

/** Dependensi produksi. Dibuat lazy di dalam createApp agar tidak ada I/O saat impor. */
function defaultServerDeps(): ServerDeps {
  return {
    fs: new NodeFileSystem(),
    runner: new NodeProcessRunner(),
    dataRoot: resolveDataRoot(),
    home: homedir(),
  };
}

export const SESSION_COOKIE = "sm_session";
export const APP_VERSION: string = packageJson.version;

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 500;

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

const STATUS_BY_CODE: Record<string, ErrorStatus> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  source_not_found: 404,
  skill_not_found: 404,
  installation_not_found: 404,
  staging_not_found: 404,
  harness_not_found: 404,
  web_not_built: 404,
  conflict: 409,
  install_conflict: 409,
  name_conflict: 409,
  drift_detected: 409,
  adopt_conflict: 409,
  shared_confirmation_required: 409,
  confirmation_required: 409,
  already_exists: 409,
  not_empty: 409,
  unsupported_version: 500,
  state_unsupported_version: 500,
  state_write_failed: 500,
  import_failed: 500,
  io_error: 500,
  permission_denied: 500,
  process_failed: 500,
  dependency_run_failed: 500,
};

/**
 * Status HTTP untuk kode galat domain (kontrak §7). Kode di luar tabel — termasuk
 * seluruh `invalid_*`/`unsafe_*`/`source_*` — adalah masukan salah, jadi 400.
 */
export function statusForCode(code: string): ErrorStatus {
  return STATUS_BY_CODE[code] ?? 400;
}

function errorBody(code: string, message: string, details?: unknown): ErrorBody {
  if (details === undefined) {
    return { error: { code, message } };
  }
  return { error: { code, message, details } };
}

function tokensMatch(given: string, expected: string): boolean {
  const givenBuffer = Buffer.from(given);
  const expectedBuffer = Buffer.from(expected);
  if (givenBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(givenBuffer, expectedBuffer);
}

function validPort(value: string): boolean {
  if (!/^\d{1,5}$/.test(value)) {
    return false;
  }
  const port = Number(value);
  return port >= 0 && port <= 65535;
}

/** Mengembalikan hostname, atau undefined bila header Host tidak bisa diparse. */
function parseHostHeader(value: string): string | undefined {
  if (value.startsWith("[")) {
    const closingBracket = value.indexOf("]");
    if (closingBracket === -1) {
      return undefined;
    }
    const hostname = value.slice(1, closingBracket);
    if (!hostname) {
      return undefined;
    }
    const remainder = value.slice(closingBracket + 1);
    if (remainder !== "") {
      if (!remainder.startsWith(":")) {
        return undefined;
      }
      if (!validPort(remainder.slice(1))) {
        return undefined;
      }
    }
    return hostname;
  }

  const parts = value.split(":");
  if (parts.length > 2) {
    return undefined;
  }
  const hostname = parts[0] ?? "";
  if (!hostname) {
    return undefined;
  }
  const port = parts[1];
  if (port !== undefined && !validPort(port)) {
    return undefined;
  }
  return hostname;
}

export type HostCheck = "ok" | 400 | 403;

/**
 * Header Host hanya boleh menunjuk ke loopback. Ini menutup DNS rebinding:
 * halaman asing yang resolve ke 127.0.0.1 tetap membawa Host miliknya sendiri.
 * Header kosong/tidak bisa diparse dijawab 400, host non-loopback 403.
 */
export function checkHost(hostHeader: string | undefined): HostCheck {
  if (hostHeader === undefined) {
    return 400;
  }

  const value = hostHeader.trim().toLowerCase();
  if (!value) {
    return 400;
  }

  const hostname = parseHostHeader(value);
  if (hostname === undefined) {
    return 400;
  }

  return LOOPBACK_HOSTNAMES.has(hostname) ? "ok" : 403;
}

function isSpaNavigation(c: Context): boolean {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    return false;
  }
  const accept = c.req.header("accept")?.toLowerCase() ?? "";
  if (!accept.includes("text/html")) {
    return false;
  }
  return extname(c.req.path) === "";
}

/**
 * Handler galat global: jangan pernah membalas text/plain atau membocorkan
 * stack. Galat domain dipetakan lewat `code`; sisanya internal_error.
 */
export function handleAppError(error: unknown, c: Context): Response {
  if (error instanceof SkillManagerError) {
    return c.json(errorBody(error.code, error.message, error.details), statusForCode(error.code));
  }
  return c.json(errorBody("internal_error", "Terjadi kesalahan internal."), 500);
}

export function createApp(options: AppOptions): Hono {
  const app = new Hono();
  const deps = options.deps ?? defaultServerDeps();

  app.use("*", async (c, next) => {
    const host = checkHost(c.req.header("host"));
    if (host === 400) {
      return c.json(errorBody("bad_request", "Header Host tidak valid."), 400);
    }
    if (host === 403) {
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

  registerHarnessRoutes(app, deps);
  registerSkillRoutes(app, deps);
  registerInstallationRoutes(app, deps);
  registerSyncRoutes(app, deps);
  registerDoctorRoutes(app, deps);
  registerDepsRoutes(app, deps);
  registerConnectRoutes(app, deps);

  app.use("*", serveStatic({ root: options.webRoot }));

  app.all("*", async (c) => {
    if (c.req.path === "/api" || c.req.path.startsWith("/api/") || !isSpaNavigation(c)) {
      return c.notFound();
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

  app.notFound((c) =>
    c.json(errorBody("not_found", `Rute ${c.req.method} ${c.req.path} tidak ditemukan.`), 404),
  );

  app.onError(handleAppError);

  return app;
}
