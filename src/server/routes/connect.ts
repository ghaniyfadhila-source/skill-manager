import type { Hono } from "hono";
import { loadAdapters } from "../../adapters/index.js";
import { SkillManagerError } from "../../core/errors.js";
import type { ServerDeps } from "./context.js";

/**
 * GET /api/connect/:harnessId (kontrak §7, AC-11).
 *
 * Hanya membaca URL dari manifest adapter. Server tidak pernah menjalankan
 * installer maupun deteksi binary di endpoint ini — tidak ada satu pun proses.
 */
export function registerConnectRoutes(app: Hono, deps: ServerDeps): void {
  app.get("/api/connect/:harnessId", async (c) => {
    const harnessId = c.req.param("harnessId");
    const { adapters } = await loadAdapters({ fs: deps.fs, dataRoot: deps.dataRoot });
    const adapter = adapters.find((entry) => entry.id === harnessId);
    if (adapter?.connect === undefined) {
      throw new SkillManagerError({
        code: "harness_not_found",
        message: `Harness "${harnessId}" tidak dikenal atau tidak punya URL installer.`,
      });
    }
    return c.json({ url: adapter.connect.installUrl });
  });
}
