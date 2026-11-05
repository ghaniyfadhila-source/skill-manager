import type { Hono } from "hono";
import { z } from "zod";
import {
  type Adapter,
  adapterCapability,
  loadAdapters,
  resolveTarget,
} from "../../adapters/index.js";
import { SkillManagerError } from "../../core/errors.js";
import { loadState } from "../../core/state.js";
import type { DriftStatus } from "../../core/types.js";
import { installSkill } from "../../install/install.js";
import { uninstallSkill } from "../../install/uninstall.js";
import { computeDrift } from "../../maintenance/drift.js";
import { readJson, type ServerDeps } from "./context.js";

const targetSchema = z.string().min(1);

const installSchema = z.object({
  skill: z.string().min(1),
  targets: z.array(targetSchema).min(1, "minimal satu Target"),
  acknowledgeShared: z.boolean().optional(),
});

const uninstallSchema = installSchema.extend({
  force: z.boolean().optional(),
});

interface InstallationView {
  readonly skillId: string;
  readonly skillName: string;
  readonly targetId: string;
  readonly storeId: string;
  readonly mode: string;
  readonly installedHash: string;
  readonly installedAt: string;
  readonly drift?: DriftStatus;
}

/** Kebalikan pemetaan Target -> Store: Store -> Id Target managed pertama. */
function targetIdsByStore(adapters: readonly Adapter[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const adapter of adapters) {
    if (adapterCapability(adapter) !== "managed") {
      continue;
    }
    for (const store of adapter.stores) {
      if (map.has(store.path)) {
        continue;
      }
      try {
        const target = resolveTarget(adapters, { harnessId: adapter.id, scope: store.scope });
        map.set(target.storeId, `${target.harnessId}/${target.scope}`);
      } catch {
        // Store tanpa Target tidak punya baris Installation untuk ditampilkan.
      }
    }
  }
  return map;
}

/**
 * Drift dicek SEBELUM mencabut agar 409 tidak meninggalkan penghapusan
 * sebagian. Domain tetap memeriksa ulang saat `force` tidak diberikan.
 */
async function assertNoDrift(
  deps: ServerDeps,
  adapters: readonly Adapter[],
  skill: string,
  targets: readonly string[],
): Promise<void> {
  const report = await computeDrift(deps.fs, deps.dataRoot, {
    adapters,
    skill,
    home: deps.home,
  });
  const byStore = new Map(report.entries.map((entry) => [entry.storeId, entry]));

  const requested = new Set<string>();
  for (const targetId of targets) {
    try {
      requested.add(resolveTarget(adapters, targetId).storeId);
    } catch {
      // Target tidak valid dilaporkan per Target oleh domain, bukan di sini.
    }
  }

  for (const storeId of requested) {
    const entry = byStore.get(storeId);
    if (entry === undefined || entry.status !== "modified") {
      continue;
    }
    throw new SkillManagerError({
      code: "drift_detected",
      message:
        `Isi ${entry.path} sudah berubah sejak dipasang (hash berbeda). ` +
        "Tidak ada yang dihapus; setujui force untuk menghapus tetap.",
      details: {
        storeId,
        path: entry.path,
        expectedHash: entry.installedHash,
        actualHash: entry.storeHash,
      },
    });
  }
}

/** GET, POST, dan DELETE /api/installations (kontrak §7). */
export function registerInstallationRoutes(app: Hono, deps: ServerDeps): void {
  const adaptersOf = async (): Promise<readonly Adapter[]> =>
    (await loadAdapters({ fs: deps.fs, dataRoot: deps.dataRoot })).adapters;

  app.get("/api/installations", async (c) => {
    const adapters = await adaptersOf();
    const { state } = await loadState(deps.fs, deps.dataRoot);
    const names = new Map(state.library.map((skill) => [skill.id, skill.name]));
    const targetIds = targetIdsByStore(adapters);
    const drift = await computeDrift(deps.fs, deps.dataRoot, { adapters, home: deps.home });
    const driftByKey = new Map(
      drift.entries
        .filter((entry) => entry.skillId !== undefined)
        .map((entry) => [`${entry.skillId}::${entry.storeId}`, entry.status]),
    );

    const installations: InstallationView[] = [];
    for (const installation of state.installations) {
      const skillName = names.get(installation.skillId);
      if (skillName === undefined) {
        continue;
      }
      const status = driftByKey.get(`${installation.skillId}::${installation.storeId}`);
      installations.push({
        skillId: installation.skillId,
        skillName,
        targetId: targetIds.get(installation.storeId) ?? installation.storeId,
        storeId: installation.storeId,
        mode: installation.mode,
        installedHash: installation.installedHash,
        installedAt: installation.installedAt,
        ...(status === undefined ? {} : { drift: status }),
      });
    }
    return c.json({ installations });
  });

  app.post("/api/installations", async (c) => {
    const body = await readJson(c, installSchema);
    const adapters = await adaptersOf();
    const results = await installSkill({
      fs: deps.fs,
      dataRoot: deps.dataRoot,
      adapters,
      home: deps.home,
      skill: body.skill,
      targets: body.targets,
      ...(body.acknowledgeShared === undefined
        ? {}
        : { acknowledgeShared: body.acknowledgeShared }),
    });
    return c.json({ results });
  });

  app.delete("/api/installations", async (c) => {
    const body = await readJson(c, uninstallSchema);
    const adapters = await adaptersOf();
    if (body.force !== true) {
      await assertNoDrift(deps, adapters, body.skill, body.targets);
    }
    const results = await uninstallSkill({
      fs: deps.fs,
      dataRoot: deps.dataRoot,
      adapters,
      home: deps.home,
      skill: body.skill,
      targets: body.targets,
      ...(body.force === undefined ? {} : { force: body.force }),
      ...(body.acknowledgeShared === undefined
        ? {}
        : { acknowledgeShared: body.acknowledgeShared }),
    });
    return c.json({ results });
  });
}
