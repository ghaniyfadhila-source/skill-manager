import { existsSync, readdirSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  rm: vi.fn(),
  rename: vi.fn(),
  copyFile: vi.fn(),
}));

const processMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  exec: vi.fn(),
  execFile: vi.fn(),
  execSync: vi.fn(),
  fork: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, ...fsMocks };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, ...processMocks };
});

import { serve } from "../../src/cli/serve.js";
import type { RunningServer } from "../../src/server/index.js";

let parentDir = "";
let dataRoot = "";
let running: RunningServer | undefined;

beforeEach(async () => {
  vi.clearAllMocks();
  parentDir = await mkdtemp(join(tmpdir(), "skill-manager-ac10-"));
  dataRoot = join(parentDir, "data-root-belum-ada");
  vi.stubEnv("SKILL_MANAGER_DATA_ROOT", dataRoot);
  vi.stubEnv("HOME", parentDir);
  vi.stubEnv("USERPROFILE", parentDir);
  vi.stubEnv("LOCALAPPDATA", parentDir);
  vi.stubEnv("XDG_DATA_HOME", parentDir);
  vi.stubEnv("APPDATA", parentDir);
});

afterEach(async () => {
  if (running) {
    await running.close();
    running = undefined;
  }
  vi.unstubAllEnvs();
  if (parentDir) {
    rmSync(parentDir, { recursive: true, force: true });
    parentDir = "";
  }
});

function assertNoSideEffects(): void {
  expect(existsSync(dataRoot)).toBe(false);
  expect(readdirSync(parentDir)).toEqual([]);
  for (const spy of Object.values(fsMocks)) {
    expect(spy).not.toHaveBeenCalled();
  }
  for (const spy of Object.values(processMocks)) {
    expect(spy).not.toHaveBeenCalled();
  }
}

describe("AC-10 startup", () => {
  it("tidak membuat data root, tidak menulis file, dan tidak menjalankan proses", async () => {
    running = await serve({ port: 0, open: false, json: true }, { log: () => undefined });

    const address = running.server.address();
    expect(address).not.toBeNull();
    if (!address || typeof address === "string") {
      throw new Error("Server harus mengembalikan alamat TCP.");
    }

    expect(address.address).toBe("127.0.0.1");
    expect(address.port).toBeGreaterThan(0);
    expect(running.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\?token=[0-9a-f]{64}$/);

    assertNoSideEffects();

    await running.close();
    running = undefined;
    assertNoSideEffects();
  });
});
