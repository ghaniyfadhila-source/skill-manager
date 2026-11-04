import { type ChildProcess, execSync, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(ROOT, "dist", "cli.js");

beforeAll(() => {
  // `pnpm run ci` menjalankan test sebelum build; artifact nyata harus segar.
  execSync("pnpm run build", { cwd: ROOT, stdio: "pipe", timeout: 240_000 });
}, 240_000);

function waitForUrl(child: ChildProcess, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (action: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      action();
    };

    timer = setTimeout(() => {
      finish(() => reject(new Error(`Timeout menunggu URL. stdout=${stdout} stderr=${stderr}`)));
    }, timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.trim()) {
          continue;
        }
        try {
          const parsed = JSON.parse(line) as { url?: unknown };
          if (typeof parsed.url === "string") {
            finish(() => resolve(parsed.url as string));
            return;
          }
        } catch {
          // Baris belum berupa JSON utuh.
        }
      }
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.once("exit", (code) => {
      finish(() => reject(new Error(`CLI keluar (${code}). stdout=${stdout} stderr=${stderr}`)));
    });
    child.once("error", (error) => {
      finish(() => reject(error));
    });
  });
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe("artifact dist", () => {
  it("punya shebang, JSON modul ter-inline, dan tanpa sourcemap", () => {
    const cliSource = readFileSync(CLI, "utf8");

    expect(cliSource.startsWith("#!/usr/bin/env node")).toBe(true);
    expect(cliSource).toContain('"0.1.0"');

    const distFiles = readdirSync(join(ROOT, "dist"), { recursive: true }).map(String);
    expect(distFiles.some((file) => file.endsWith(".map"))).toBe(false);
  });
});

describe("CLI serve lewat dist", () => {
  it("menegakkan auth cookie pada proses nyata", async () => {
    const parentDir = await mkdtemp(join(tmpdir(), "sm-cli-serve-"));
    const dataRoot = join(parentDir, "data-root-belum-ada");
    let child: ChildProcess | undefined;

    try {
      child = spawn(process.execPath, [CLI, "serve", "--json", "--no-open"], {
        cwd: ROOT,
        env: { ...process.env, SKILL_MANAGER_DATA_ROOT: dataRoot },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const url = await waitForUrl(child, 30_000);

      const noCookie = await fetch(new URL("/api/health", url));
      expect(noCookie.status).toBe(401);

      const auth = await fetch(url, { redirect: "manual" });
      expect(auth.status).toBe(302);
      expect(auth.headers.get("location")).toBe("/");

      const setCookie = auth.headers.getSetCookie()[0] ?? "";
      expect(setCookie).toContain("sm_session=");
      expect(setCookie.toLowerCase()).toContain("httponly");
      const cookie = setCookie.split(";")[0] ?? "";

      const health = await fetch(new URL("/api/health", url), {
        headers: { Cookie: cookie },
      });
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true, version: "0.1.0" });
      expect(existsSync(dataRoot)).toBe(false);
    } finally {
      if (child) {
        child.kill();
        await waitForExit(child, 10_000);
      }
      rmSync(parentDir, { recursive: true, force: true });
    }
  }, 120_000);
});
