import type { Hono } from "hono";
import { type Adapter, adapterCapability, recheck, resolveTarget } from "../../adapters/index.js";
import type { Harness, Scope } from "../../core/types.js";
import type { ServerDeps } from "./context.js";

/** Satu Target yang bisa dituju UI untuk harness managed (kontrak §7). */
interface HarnessTargetView {
  readonly id: string;
  readonly harnessId: string;
  readonly scope: Scope;
  readonly storeId: string;
}

interface HarnessView {
  readonly id: string;
  readonly name: string;
  readonly capability: Harness["capability"];
  readonly detected: boolean;
  readonly detectionReasons: readonly string[];
  readonly storeIds: readonly string[];
  readonly targets: readonly HarnessTargetView[];
  readonly connect?: { readonly installUrl: string };
}

/** Target managed yang dipetakan dari Store harness itu (spec §5.1). */
function targetsFor(adapters: readonly Adapter[], harness: Harness): HarnessTargetView[] {
  const adapter = adapters.find((entry) => entry.id === harness.id);
  if (adapter === undefined || adapterCapability(adapter) !== "managed") {
    return [];
  }

  const targets: HarnessTargetView[] = [];
  for (const store of adapter.stores) {
    try {
      const target = resolveTarget(adapters, { harnessId: adapter.id, scope: store.scope });
      targets.push({
        id: `${target.harnessId}/${target.scope}`,
        harnessId: target.harnessId,
        scope: target.scope,
        storeId: target.storeId,
      });
    } catch {
      // Store yang tidak bisa dipetakan ke Target tidak ditawarkan ke UI.
    }
  }
  return targets;
}

function toView(adapters: readonly Adapter[], harness: Harness): HarnessView {
  return {
    id: harness.id,
    name: harness.name,
    capability: harness.capability,
    detected: harness.detected,
    detectionReasons: [...harness.detectionReasons],
    storeIds: [...harness.storeIds],
    targets: targetsFor(adapters, harness),
    ...(harness.connect === undefined
      ? {}
      : { connect: { installUrl: harness.connect.installUrl } }),
  };
}

/**
 * GET /api/harnesses dan POST /api/harnesses/recheck (kontrak §7).
 *
 * Keduanya memakai `recheck` domain: Recheck hanyalah deteksi ulang tanpa
 * restart, jadi server tidak menyimpan hasil deteksi di antara request.
 */
export function registerHarnessRoutes(app: Hono, deps: ServerDeps): void {
  const detect = async (): Promise<{ harnesses: HarnessView[] }> => {
    const result = await recheck({
      fs: deps.fs,
      runner: deps.runner,
      dataRoot: deps.dataRoot,
      home: deps.home,
    });
    return { harnesses: result.harnesses.map((harness) => toView(result.adapters, harness)) };
  };

  app.get("/api/harnesses", async (c) => c.json(await detect()));
  app.post("/api/harnesses/recheck", async (c) => c.json(await detect()));
}
