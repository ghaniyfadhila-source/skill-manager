import { spawn } from "node:child_process";
import { createServer, type RunningServer } from "../server/index.js";

export interface ServeOptions {
  port: number;
  open: boolean;
  json: boolean;
}

export interface ServeHooks {
  /** Pengganti console.log agar test tidak berisik. */
  log?: (line: string) => void;
  /** Pengganti pembuka browser; default memakai perintah OS. */
  openBrowser?: (url: string) => void;
}

export function openBrowser(url: string): void {
  const isWindows = process.platform === "win32";
  const command = isWindows ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = isWindows ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => undefined);
  child.unref();
}

/**
 * Menyalakan server dan mencetak URL ber-token. Fungsi ini tidak mendaftarkan
 * signal handler supaya bisa dipanggil langsung oleh test tanpa efek samping.
 */
export async function serve(options: ServeOptions, hooks: ServeHooks = {}): Promise<RunningServer> {
  const running = await createServer({ port: options.port });
  const log = hooks.log ?? ((line: string) => console.log(line));

  if (options.json) {
    log(JSON.stringify({ url: running.url, port: running.port }));
  } else {
    log(`Skill Manager berjalan di port ${running.port}`);
    log(`Buka: ${running.url}`);
  }

  if (options.open) {
    (hooks.openBrowser ?? openBrowser)(running.url);
  }

  return running;
}
