import type { FsResult } from "./types.js";

/**
 * Seam untuk menjalankan proses eksternal.
 *
 * Ticket 03 (verifikasi `--version`), 05 (git clone), dan 09 (npm/uv) butuh
 * menjalankan binary. Semua lewat antarmuka ini agar bisa diuji tanpa binary
 * yang benar-benar terpasang, dan agar tidak ada satu pun pemanggilan shell.
 */

export interface ProcessRunOptions {
  /** Direktori kerja proses. Default: direktori kerja proses induk. */
  readonly cwd?: string;
  /** Batas waktu; proses dibunuh bila terlampaui. Default 5000 ms. */
  readonly timeoutMs?: number;
  /** Variabel lingkungan tambahan (digabung dengan env proses induk). */
  readonly env?: Record<string, string>;
  /** Batas ukuran keluaran per stream. Default 1 MiB. */
  readonly maxBufferBytes?: number;
}

export interface ProcessResult {
  /** Exit code, atau null bila proses dibunuh (mis. timeout). */
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** true bila proses dibunuh karena melewati `timeoutMs`. */
  readonly timedOut: boolean;
}

export interface ProcessRunner {
  /**
   * Jalankan `command` dengan argumen array. Tidak pernah lewat shell: argumen
   * berisi spasi, kutip, atau `;` diteruskan apa adanya.
   */
  run(
    command: string,
    args: readonly string[],
    options?: ProcessRunOptions,
  ): Promise<FsResult<ProcessResult>>;
}

/** Default batas waktu proses (kontrak: verifikasi binary 5 detik). */
export const DEFAULT_PROCESS_TIMEOUT_MS = 5000;

/** Default batas ukuran keluaran per stream. */
export const DEFAULT_MAX_BUFFER_BYTES = 1024 * 1024;
