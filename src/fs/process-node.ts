import { execFile } from "node:child_process";
import {
  DEFAULT_MAX_BUFFER_BYTES,
  DEFAULT_PROCESS_TIMEOUT_MS,
  type ProcessResult,
  type ProcessRunner,
  type ProcessRunOptions,
} from "./process.js";
import type { FsError, FsErrorCode, FsResult } from "./types.js";
import { fsOk } from "./types.js";

const PROCESS_ERROR_CODES: Record<string, FsErrorCode> = {
  ENOENT: "process_not_found",
  EACCES: "permission_denied",
  EPERM: "permission_denied",
};

function errnoOf(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code?.toString();
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toProcessError(error: unknown, command: string): FsError {
  const errno = errnoOf(error);
  const code = PROCESS_ERROR_CODES[errno ?? ""] ?? "process_failed";
  const message =
    code === "process_not_found"
      ? 'Perintah "' + command + '" tidak ditemukan di PATH.'
      : 'Perintah "' + command + '" gagal dijalankan: ' + describe(error);
  return { code, path: command, message, cause: error };
}

/** Bentuk error yang disediakan `execFile` saat proses tidak keluar normal. */
interface ExecFailure extends Error {
  readonly code?: number | string;
  readonly killed?: boolean;
  readonly signal?: string | null;
}

/**
 * Implementasi ProcessRunner di atas `child_process.execFile`.
 *
 * Sengaja memakai `execFile` dan bukan `exec`: tidak ada shell, jadi argumen
 * tidak pernah diinterpolasi dan tidak ada risiko injeksi perintah.
 */
export class NodeProcessRunner implements ProcessRunner {
  async run(
    command: string,
    args: readonly string[],
    options: ProcessRunOptions = {},
  ): Promise<FsResult<ProcessResult>> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
    const maxBuffer = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;

    return await new Promise<FsResult<ProcessResult>>((resolve) => {
      execFile(
        command,
        [...args],
        {
          cwd: options.cwd,
          env: options.env ? { ...process.env, ...options.env } : process.env,
          timeout: timeoutMs,
          killSignal: "SIGKILL",
          maxBuffer,
          windowsHide: true,
          shell: false,
        },
        (error, stdout, stderr) => {
          if (error === null) {
            resolve(fsOk({ code: 0, stdout, stderr, timedOut: false }));
            return;
          }

          const failure = error as ExecFailure;
          const errno = errnoOf(failure);

          if (errno === "ENOENT" || errno === "EACCES" || errno === "EPERM") {
            resolve({ ok: false, error: toProcessError(failure, command) });
            return;
          }

          const killed = failure.killed === true || failure.signal != null;
          const exitCode = typeof failure.code === "number" ? failure.code : null;

          // Proses yang keluar non-nol bukan kegagalan runner: pemanggil yang
          // memutuskan artinya (mis. `git rev-parse` gagal pada repo non-git).
          resolve(
            fsOk({
              code: killed ? null : exitCode,
              stdout,
              stderr,
              timedOut: killed,
            }),
          );
        },
      );
    });
  }
}

export function createNodeProcessRunner(): ProcessRunner {
  return new NodeProcessRunner();
}
