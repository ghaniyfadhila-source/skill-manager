import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type RunningServer } from "../../src/server/index.js";

let running: RunningServer | undefined;
let dataRoot = "";

afterEach(async () => {
  if (running) {
    await running.close();
    running = undefined;
  }
  vi.unstubAllEnvs();
  if (dataRoot) {
    await rm(dataRoot, { recursive: true, force: true });
    dataRoot = "";
  }
});

describe("startup server", () => {
  it("mendengarkan hanya di 127.0.0.1 pada port acak dan menyusun URL ber-token", async () => {
    dataRoot = await mkdtemp(join(tmpdir(), "skill-manager-data-"));
    vi.stubEnv("SKILL_MANAGER_DATA_ROOT", dataRoot);

    running = await createServer();
    const address = running.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Server harus mengembalikan alamat TCP.");
    }

    expect(address.address).toBe("127.0.0.1");
    expect(address.port).toBeGreaterThan(0);
    expect(running.port).toBe(address.port);
    expect(running.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\?token=[0-9a-f]{64}$/);

    const response = await fetch(running.url, { redirect: "manual" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");

    expect(await readdir(dataRoot)).toEqual([]);
  });
});
