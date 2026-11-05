import { describe, expect, it } from "vitest";
import { NodeProcessRunner } from "./process-node.js";

const runner = new NodeProcessRunner();

/** Nama binary Node yang sedang menjalankan test. */
const NODE = process.execPath;

describe("NodeProcessRunner", () => {
  it("mengembalikan stdout dan exit code 0", async () => {
    const result = await runner.run(NODE, ["-e", "console.log('halo')"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.code).toBe(0);
      expect(result.value.stdout.trim()).toBe("halo");
      expect(result.value.timedOut).toBe(false);
    }
  });

  it("meneruskan exit code non-nol tanpa menganggapnya kegagalan runner", async () => {
    const result = await runner.run(NODE, ["-e", "process.exit(3)"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.code).toBe(3);
      expect(result.value.timedOut).toBe(false);
    }
  });

  it("memetakan binary yang tidak ada ke process_not_found", async () => {
    const result = await runner.run("binary-yang-pasti-tidak-ada-xyz", ["--version"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("process_not_found");
    }
  });

  it("tidak melewati shell: argumen berisi spasi dan titik koma diteruskan apa adanya", async () => {
    const nasty = "a b; rm -rf /";
    const script = "console.log(process.argv[1])";
    const result = await runner.run(NODE, ["-e", script, nasty]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stdout.trim()).toBe(nasty);
    }
  });

  it("membunuh proses yang melewati batas waktu", async () => {
    const started = Date.now();
    const result = await runner.run(NODE, ["-e", "setTimeout(() => {}, 30000)"], {
      timeoutMs: 300,
    });
    const elapsed = Date.now() - started;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.timedOut).toBe(true);
      expect(result.value.code).toBeNull();
    }
    expect(elapsed).toBeLessThan(10000);
  });

  it.skipIf(process.platform !== "win32")(
    "mengubah EINVAL Windows (.cmd tanpa shell) menjadi FsResult, bukan exception",
    async () => {
      // execFile melempar SINKRON untuk shim .cmd; tanpa tangkapan di runner
      // galat ini lolos sebagai exception dan berubah menjadi 500.
      const result = await runner.run("C:\\Windows\\System32\\npm.cmd", ["--version"]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("process_failed");
      }
    },
  );

  it("menghormati cwd", async () => {
    const result = await runner.run(NODE, ["-e", "console.log(process.cwd())"], {
      cwd: process.cwd(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stdout.trim()).toBe(process.cwd());
    }
  });
});
