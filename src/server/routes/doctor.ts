import type { Hono } from "hono";
import { loadAdapters } from "../../adapters/index.js";
import { cleanTempDirs, runDoctor } from "../../maintenance/doctor.js";
import type { ServerDeps } from "./context.js";

/** GET /api/doctor dan POST /api/doctor/clean-temp (kontrak §7). */
export function registerDoctorRoutes(app: Hono, deps: ServerDeps): void {
  const options = async () => ({
    adapters: (await loadAdapters({ fs: deps.fs, dataRoot: deps.dataRoot })).adapters,
    home: deps.home,
  });

  app.get("/api/doctor", async (c) => {
    const report = await runDoctor(deps.fs, deps.dataRoot, await options());
    return c.json(report);
  });

  // Hanya direktori ber-prefix sementara yang dihapus (spec §14, AC-12).
  app.post("/api/doctor/clean-temp", async (c) => {
    const removed = await cleanTempDirs(deps.fs, deps.dataRoot, await options());
    return c.json({ removed });
  });
}
