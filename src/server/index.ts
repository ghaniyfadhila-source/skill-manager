import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { createApp } from "./app.js";

export interface CreateServerOptions {
  port?: number;
  /** Hanya untuk pengujian; produksi selalu memakai token acak baru. */
  token?: string;
  webRoot?: string;
}

export interface RunningServer {
  server: Server;
  host: string;
  port: number;
  token: string;
  origin: string;
  /** URL pembuka ber-token yang ditukar menjadi cookie sesi oleh /auth. */
  url: string;
  close: () => Promise<void>;
}

/**
 * Saat dibundel (dist/cli.js atau dist/server.js) UI ada di dist/web.
 * Saat dijalankan langsung dari sumber (Vitest) UI ada di src/web.
 */
function resolveDefaultWebRoot(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const bundled = join(moduleDir, "web");
  if (existsSync(join(bundled, "index.html"))) {
    return bundled;
  }
  const fromSource = join(moduleDir, "..", "web");
  if (existsSync(join(fromSource, "index.html"))) {
    return fromSource;
  }
  return bundled;
}

const DEFAULT_WEB_ROOT = resolveDefaultWebRoot();

export async function createServer(options: CreateServerOptions = {}): Promise<RunningServer> {
  const host = "127.0.0.1";
  const requestedPort = options.port ?? 0;
  const token = options.token ?? randomBytes(32).toString("hex");
  const webRoot = options.webRoot ?? DEFAULT_WEB_ROOT;

  const app = createApp({ token, webRoot });
  const server = createHttpServer(getRequestListener(app.fetch));

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(requestedPort, host);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Server tidak mengembalikan alamat TCP.");
  }

  const port = address.port;
  const origin = `http://${host}:${port}`;

  return {
    server,
    host,
    port,
    token,
    origin,
    url: `${origin}/auth?token=${token}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
        server.closeAllConnections();
      }),
  };
}
