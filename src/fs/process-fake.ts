import type { ProcessResult, ProcessRunner, ProcessRunOptions } from "./process.js";
import { type FsResult, fsErr, fsOk } from "./types.js";

/** Satu pemanggilan yang direkam FakeProcessRunner. */
export interface RecordedCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: ProcessRunOptions;
}

/** Respons terskrip untuk satu kombinasi command + args. */
export type FakeResponse =
  | {
      readonly type: "exit";
      readonly code: number;
      readonly stdout?: string;
      readonly stderr?: string;
    }
  | { readonly type: "timeout" }
  | { readonly type: "not_found" }
  | { readonly type: "failed"; readonly message: string };

function keyOf(command: string, args: readonly string[]): string {
  return [command, ...args].join("\u0000");
}

/**
 * ProcessRunner palsu untuk test.
 *
 * Tidak pernah menjalankan proses sungguhan: respons diambil dari skrip yang
 * didaftarkan, dan setiap pemanggilan direkam agar test bisa meng-assert
 * perintah PERSIS yang akan dijalankan aplikasi (mis. flag `--ignore-scripts`).
 */
export class FakeProcessRunner implements ProcessRunner {
  private readonly responses = new Map<string, FakeResponse>();
  private readonly recorded: RecordedCall[] = [];
  private fallback: FakeResponse = { type: "exit", code: 0 };

  /** Daftarkan respons untuk kombinasi command + args tertentu. */
  on(command: string, args: readonly string[], response: FakeResponse): this {
    this.responses.set(keyOf(command, args), response);
    return this;
  }

  /** Respons untuk perintah yang tidak terdaftar. Default: exit 0. */
  otherwise(response: FakeResponse): this {
    this.fallback = response;
    return this;
  }

  /** Semua pemanggilan, berurutan. */
  get calls(): readonly RecordedCall[] {
    return this.recorded;
  }

  /** Argumen array dari pemanggilan terakhir, untuk assertion ringkas. */
  get lastArgs(): readonly string[] {
    return this.recorded.at(-1)?.args ?? [];
  }

  async run(
    command: string,
    args: readonly string[],
    options: ProcessRunOptions = {},
  ): Promise<FsResult<ProcessResult>> {
    this.recorded.push({ command, args: [...args], options });
    const response = this.responses.get(keyOf(command, args)) ?? this.fallback;

    switch (response.type) {
      case "timeout":
        return fsOk({ code: null, stdout: "", stderr: "", timedOut: true });
      case "not_found":
        return fsErr(
          "process_not_found",
          command,
          `Perintah "${command}" tidak ditemukan di PATH.`,
        );
      case "failed":
        return fsErr("process_failed", command, response.message);
      case "exit":
        return fsOk({
          code: response.code,
          stdout: response.stdout ?? "",
          stderr: response.stderr ?? "",
          timedOut: false,
        });
    }
  }
}
