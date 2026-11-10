import type { Hono } from "hono";
import { enrichCatalog } from "../../catalog/github.js";
import { CATALOG_SEED } from "../../catalog/seed.js";
import { loadState } from "../../core/state.js";
import type { ServerDeps } from "./context.js";

/** GET /api/catalog: allowlist terkurasi + bintang hidup + tanda sudah terpasang. */
export function registerCatalogRoutes(app: Hono, deps: ServerDeps): void {
  app.get("/api/catalog", async (c) => {
    const fetchFn = deps.fetch ?? ((url: string) => globalThis.fetch(url));
    const items = await enrichCatalog(CATALOG_SEED, fetchFn);

    const { state } = await loadState(deps.fs, deps.dataRoot);
    const installed = new Set(state.library.map((skill) => skill.name));

    return c.json({
      items: items.map((item) => ({ ...item, installed: installed.has(item.name) })),
    });
  });
}
