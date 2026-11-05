import type { Hono } from "hono";
import { z } from "zod";
import { planDependencies } from "../../deps/plan.js";
import { runDependencies } from "../../deps/run.js";
import { readJson, type ServerDeps, unwrap } from "./context.js";
import { findSkill, skillDirectory } from "./skills.js";

const planSchema = z.object({ skill: z.string().min(1) });
const runSchema = planSchema.extend({ allowScripts: z.boolean().optional() });

/** POST /api/deps/plan dan POST /api/deps/run (kontrak §7, spec §10.6). */
export function registerDepsRoutes(app: Hono, deps: ServerDeps): void {
  app.post("/api/deps/plan", async (c) => {
    const body = await readJson(c, planSchema);
    const skill = await findSkill(deps, body.skill);
    const commands = unwrap(
      await planDependencies(deps.fs, skillDirectory(deps, skill), {
        dataRoot: deps.dataRoot,
        skillId: skill.dirName,
      }),
    );
    return c.json({ commands });
  });

  app.post("/api/deps/run", async (c) => {
    const body = await readJson(c, runSchema);
    const skill = await findSkill(deps, body.skill);
    const report = await runDependencies({
      fs: deps.fs,
      runner: deps.runner,
      dataRoot: deps.dataRoot,
      skillId: skill.dirName,
      skillDir: skillDirectory(deps, skill),
      ...(body.allowScripts === undefined ? {} : { allowScripts: body.allowScripts }),
    });
    return c.json({ ok: report.ok, output: report.results });
  });
}
