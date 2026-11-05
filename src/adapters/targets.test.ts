import path from "node:path";
import { describe, expect, it } from "vitest";
import { SkillManagerError } from "../core/errors.js";
import type { Target } from "../core/types.js";
import { MemoryFileSystem } from "../fs/memory.js";
import { loadAdapters } from "./loader.js";
import type { Adapter } from "./manifest.js";
import { listStores, parseTargetId, resolveTarget } from "./targets.js";

const HOME = path.resolve(path.sep, "sm-home");
const DATA_ROOT = path.resolve(path.sep, "sm-targets-data");

async function bundled(): Promise<readonly Adapter[]> {
  const catalog = await loadAdapters({ fs: new MemoryFileSystem(), dataRoot: DATA_ROOT });
  return catalog.adapters;
}

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof SkillManagerError) {
      return error.code;
    }
    throw error;
  }
  throw new Error("Fungsi seharusnya melempar SkillManagerError");
}

function resolve(adapters: readonly Adapter[], target: string, shared = false): Target {
  return resolveTarget(adapters, target, { shared });
}

describe("parseTargetId", () => {
  it("memecah harness dan scope", async () => {
    expect(parseTargetId("opencode/global")).toEqual({ harnessId: "opencode", scope: "global" });
    expect(codeOf(() => parseTargetId("opencode"))).toBe("invalid_target");
    expect(codeOf(() => parseTargetId("opencode/mesin"))).toBe("invalid_target");
  });
});

describe("resolveTarget", () => {
  it("memetakan setiap Target managed ke tepat satu Store", async () => {
    const adapters = await bundled();

    expect(resolve(adapters, "claude-code/global").storeId).toBe("~/.claude/skills");
    expect(resolve(adapters, "antigravity/global").storeId).toBe("~/.gemini/config/skills");
    expect(resolve(adapters, "shared/global").storeId).toBe("~/.agents/skills");
  });

  it("opencode default memakai Store eksklusifnya", async () => {
    const adapters = await bundled();
    const target = resolve(adapters, "opencode/global");

    expect(target).toEqual({
      harnessId: "opencode",
      scope: "global",
      storeId: "~/.config/opencode/skills",
    });
  });

  it("opencode bisa dialihkan ke grup shared atas permintaan user", async () => {
    const adapters = await bundled();

    expect(resolve(adapters, "opencode/global", true).storeId).toBe("~/.agents/skills");
  });

  it("menolak opsi shared untuk harness yang tidak membaca shared", async () => {
    const adapters = await bundled();

    expect(codeOf(() => resolve(adapters, "claude-code/global", true))).toBe(
      "shared_not_supported",
    );
  });

  it("harness detected-only tidak bisa dipilih sebagai Target", async () => {
    const adapters = await bundled();

    expect(codeOf(() => resolve(adapters, "hermes/global"))).toBe("target_not_managed");
    expect(codeOf(() => resolve(adapters, "devin/global"))).toBe("target_not_managed");
  });

  it("adapter tanpa verified.at tidak bisa dipilih sebagai Target", async () => {
    const fs = new MemoryFileSystem();
    const file = path.join(DATA_ROOT, "adapters", "opencode.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.write(
      file,
      JSON.stringify({
        id: "opencode",
        name: "opencode",
        tier: "managed",
        detect: { paths: ["~/.config/opencode"], binaries: [], versionArgs: [] },
        stores: [{ scope: "global", path: "~/.config/opencode/skills", exclusive: true }],
        readsShared: true,
      }),
    );
    const catalog = await loadAdapters({ fs, dataRoot: DATA_ROOT });

    expect(codeOf(() => resolve(catalog.adapters, "opencode/global"))).toBe("target_not_managed");
  });

  it("menolak harness yang tidak dikenal dan scope yang belum tersedia", async () => {
    const adapters = await bundled();

    expect(codeOf(() => resolve(adapters, "tidak-ada/global"))).toBe("unknown_target");
    expect(codeOf(() => resolve(adapters, "opencode/project"))).toBe("target_not_available");
  });
});

describe("listStores", () => {
  it("mengembalikan empat Store managed dengan path absolut dan member", async () => {
    const stores = listStores(await bundled(), { home: HOME });
    const ids = stores.map((store) => store.id);

    expect(ids).toEqual([
      "~/.claude/skills",
      "~/.config/opencode/skills",
      "~/.gemini/config/skills",
      "~/.agents/skills",
    ]);
    expect(stores[0]?.path).toBe(path.join(HOME, ".claude", "skills"));
    expect(stores[0]?.exclusive).toBe(true);
    expect(stores[0]?.members).toEqual(["claude-code"]);

    const shared = stores.at(-1);
    expect(shared?.exclusive).toBe(false);
    expect(shared?.members).toContain("codex");
    expect(shared?.path).toBe(path.join(HOME, ".agents", "skills"));
  });

  it("tidak menawarkan Store milik adapter detected-only", async () => {
    const stores = listStores(await bundled(), { home: HOME });

    expect(stores.some((store) => store.members.includes("hermes"))).toBe(false);
  });
});
