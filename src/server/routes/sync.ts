import type { Hono } from "hono";
import { z } from "zod";
import { loadAdapters } from "../../adapters/index.js";
import { SkillManagerError } from "../../core/errors.js";
import { loadState } from "../../core/state.js";
import { syncSkill } from "../../maintenance/sync.js";
import { readJson, type ServerDeps } from "./context.js";
import { summarizeSkill } from "./skills.js";

const syncSchema = z.object({
  skill: z.string().min(1),
  action: z.enum(["restore", "adopt"]),
});

/**
 * POST /api/sync (kontrak §7).
 *
 * confirm: true selalu dikirim: menekan tombol Sync di UI adalah konfirmasi
 * eksplisit user (spec §10.5, AC-8). Server tidak pernah menyinkron sendiri.
 */
export function registerSyncRoutes(app: Hono, deps: ServerDeps): void {
  app.post("/api/sync", async (c) => {
    const body = await readJson(c, syncSchema);
    const { adapters } = await loadAdapters({ fs: deps.fs, dataRoot: deps.dataRoot });

    await syncSkill({
      fs: deps.fs,
      dataRoot: deps.dataRoot,
      adapters,
      home: deps.home,
      skill: body.skill,
      action: body.action,
      confirm: true,
    });

    const { state } = await loadState(deps.fs, deps.dataRoot);
    const skill = state.library.find(
      (entry) => entry.name === body.skill || entry.id === body.skill,
    );
    if (skill === undefined) {
      throw new SkillManagerError({
        code: "skill_not_found",
        message: `Skill "${body.skill}" tidak ada di Library.`,
      });
    }
    return c.json({ skill: summarizeSkill(skill) });
  });
}
