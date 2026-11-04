/**
 * Permukaan publik modul adapter untuk ticket 06 (pasang/cabut) dan ticket 10
 * (UI/CLI): muat manifest, deteksi harness, Recheck, petakan Target ke Store.
 */
export { BUNDLED_ADAPTERS } from "./bundled.js";
export {
  type DetectOptions,
  detectHarnesses,
  type RecheckOptions,
  type RecheckResult,
  recheck,
} from "./detect.js";
export { expandHome, platformPath } from "./home.js";
export {
  type AdapterCatalog,
  type AdapterProblem,
  type LoadAdaptersOptions,
  loadAdapters,
} from "./loader.js";
export {
  type Adapter,
  type AdapterScope,
  type AdapterStore,
  type AdapterTier,
  adapterCapability,
  adapterSchema,
} from "./manifest.js";
export {
  listStores,
  parseTargetId,
  type ResolveTargetOptions,
  resolveTarget,
  type StoreListOptions,
} from "./targets.js";
