import { describe, expect, it } from "vitest";
import { DEFAULT_PROCESS_TIMEOUT_MS } from "./process.js";
import { FakeProcessRunner } from "./process-fake.js";

describe("FakeProcessRunner", () => {
  it("mengembalikan respons terskrip untuk command + args tertentu", async () => {
    const runner = new FakeProcessRunner().on("opencode", ["--version"], {
      type: "exit",
      code: 0,
      stdout: "2.0.24\n",
    });

    const result = await runner.run("opencode", ["--version"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.code).toBe(0);
      expect(result.value.stdout.trim()).toBe("2.0.24");
      expect(result.value.timedOut).toBe(false);
    }
  });

  it("merekam setiap pemanggilan agar test bisa meng-assert perintah persis", async () => {
    const runner = new FakeProcessRunner();
    await runner.run("npm", ["install", "--ignore-scripts"], { cwd: "/tmp/deps" });
    await runner.run("uv", ["pip", "install", "-r", "requirements.txt"]);

    expect(runner.calls).toHaveLength(2);
    expect(runner.calls[0]?.command).toBe("npm");
    expect(runner.calls[0]?.args).toEqual(["install", "--ignore-scripts"]);
    expect(runner.calls[0]?.options.cwd).toBe("/tmp/deps");
    expect(runner.lastArgs).toEqual(["pip", "install", "-r", "requirements.txt"]);
  });

  it("meneruskan argumen apa adanya, termasuk spasi dan titik koma", async () => {
    const runner = new FakeProcessRunner();
    const nasty = ["a b", "; rm -rf /", "$(whoami)", "`id`"];
    await runner.run("git", nasty);

    expect(runner.lastArgs).toEqual(nasty);
  });

  it("mensimulasikan timeout dengan code null dan timedOut true", async () => {
    const runner = new FakeProcessRunner().otherwise({ type: "timeout" });
    const result = await runner.run("slow-binary", ["--version"]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.code).toBeNull();
      expect(result.value.timedOut).toBe(true);
    }
  });

  it("memetakan binary yang tidak ada ke process_not_found", async () => {
    const runner = new FakeProcessRunner().otherwise({ type: "not_found" });
    const result = await runner.run("tidak-ada", ["--version"]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("process_not_found");
    }
  });

  it("memakai respons fallback bila kombinasi tidak terdaftar", async () => {
    const runner = new FakeProcessRunner()
      .on("git", ["rev-parse", "HEAD"], { type: "exit", code: 0, stdout: "abc123" })
      .otherwise({ type: "exit", code: 1, stderr: "boom" });

    const known = await runner.run("git", ["rev-parse", "HEAD"]);
    const unknown = await runner.run("git", ["status"]);

    expect(known.ok && known.value.stdout).toBe("abc123");
    expect(unknown.ok && unknown.value.code).toBe(1);
  });
});

describe("default proses", () => {
  it("memakai batas waktu 5 detik sesuai kontrak deteksi", () => {
    expect(DEFAULT_PROCESS_TIMEOUT_MS).toBe(5000);
  });
});
