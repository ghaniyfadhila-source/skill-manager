import { homedir } from "node:os";
import { SkillManagerError } from "../core/errors.js";
import type { Scope, Store, Target } from "../core/types.js";
import { expandHome, platformPath } from "./home.js";
import { type Adapter, adapterCapability } from "./manifest.js";

export interface ResolveTargetOptions {
  /** Pasang ke grup shared, bukan Store eksklusif (spec §5.1). */
  readonly shared?: boolean;
}

export interface StoreListOptions {
  readonly home?: string;
  readonly platform?: NodeJS.Platform;
}

/** Format id Target: "harness/scope", mis. "opencode/global" (kontrak §7). */
export function parseTargetId(targetId: string): { harnessId: string; scope: Scope } {
  const [harnessId, scope, ...rest] = targetId.split("/");
  if (
    harnessId === undefined ||
    harnessId.length === 0 ||
    rest.length > 0 ||
    (scope !== "global" && scope !== "project")
  ) {
    throw new SkillManagerError({
      code: "invalid_target",
      message: `Target "${targetId}" tidak valid; format yang benar mis. "opencode/global".`,
    });
  }
  return { harnessId, scope };
}

function sharedStore(
  adapters: readonly Adapter[],
  scope: Scope,
): Adapter["stores"][number] | undefined {
  for (const adapter of adapters) {
    if (adapterCapability(adapter) !== "managed") {
      continue;
    }
    const store = adapter.stores.find((entry) => entry.scope === scope && !entry.exclusive);
    if (store !== undefined) {
      return store;
    }
  }
  return undefined;
}

/**
 * Pemetaan Target -> Store (spec §5.1): setiap (harness, scope) menghasilkan
 * tepat satu Store. opencode default memakai Store eksklusifnya; opsi shared
 * memindahkannya ke grup shared dan menghilangkan isolasi.
 */
export function resolveTarget(
  adapters: readonly Adapter[],
  target: string | { readonly harnessId: string; readonly scope: Scope },
  options: ResolveTargetOptions = {},
): Target {
  const { harnessId, scope } = typeof target === "string" ? parseTargetId(target) : target;
  const adapter = adapters.find((entry) => entry.id === harnessId);
  if (adapter === undefined) {
    throw new SkillManagerError({
      code: "unknown_target",
      message: `Harness "${harnessId}" tidak dikenal.`,
    });
  }
  if (adapterCapability(adapter) !== "managed") {
    throw new SkillManagerError({
      code: "target_not_managed",
      message: `Harness "${harnessId}" berstatus detected-only sehingga tidak bisa dipilih sebagai Target.`,
    });
  }

  if (options.shared === true) {
    const shared = sharedStore(adapters, scope);
    if (!adapter.readsShared || shared === undefined) {
      throw new SkillManagerError({
        code: "shared_not_supported",
        message: `Harness "${harnessId}" tidak membaca Store shared.`,
      });
    }
    return { harnessId, scope, storeId: shared.path };
  }

  const store = adapter.stores.find((entry) => entry.scope === scope);
  if (store === undefined) {
    throw new SkillManagerError({
      code: "target_not_available",
      message: `Target "${harnessId}/${scope}" belum tersedia di v0.1.`,
    });
  }
  return { harnessId, scope, storeId: store.path };
}

/**
 * Store yang bisa dituju Target managed, dengan path absolut (spec §5.1).
 * Store milik adapter detected-only atau adapter tanpa verified.at tidak
 * ditawarkan karena tidak ada Target yang memetakan ke sana.
 */
export function listStores(adapters: readonly Adapter[], options: StoreListOptions = {}): Store[] {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const stores: Store[] = [];
  const seen = new Set<string>();

  for (const adapter of adapters) {
    if (adapterCapability(adapter) !== "managed") {
      continue;
    }
    for (const store of adapter.stores) {
      if (seen.has(store.path)) {
        continue;
      }
      seen.add(store.path);
      stores.push({
        id: store.path,
        path: expandHome(store.path, home, platform),
        members: store.members === undefined ? [adapter.id] : [...store.members],
        exclusive: store.exclusive,
      });
    }
  }

  return stores;
}

/** Helper untuk test dan pemanggil yang butuh path flavor platform. */
export { platformPath };
