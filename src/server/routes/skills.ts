import path from "node:path";
import type { Hono } from "hono";
import { z } from "zod";
import { SkillManagerError } from "../../core/errors.js";
import { libraryRoot } from "../../core/paths.js";
import { findLibrarySkill } from "../../core/skill-lookup.js";
import { loadState } from "../../core/state.js";
import type { Skill } from "../../core/types.js";
import { planDependencies } from "../../deps/plan.js";
import { isPathInside } from "../../fs/guard.js";
import { importFolderSkill } from "../../library/import-folder.js";
import { type InspectNode, type InspectResult, inspectSource } from "../../library/inspect.js";
import {
  cleanStaleStaging,
  importStaged,
  type StagedSource,
  stageFromFolder,
  stageFromGit,
  stageFromZip,
} from "../../library/staging.js";
import { asDomainError, readJson, type ServerDeps } from "./context.js";

interface SkillFileView {
  readonly path: string;
  readonly bytes: number;
  readonly risk?: string;
}

const nameSchema = z
  .string()
  .min(1, "nama skill wajib diisi")
  .max(200)
  .refine((value) => value !== "." && value !== ".." && !/[\\/]/.test(value), {
    message: "nama skill tidak boleh berupa path",
  });

/** Ringkasan skill sesuai state.json; lisensi hanya ada bila tercatat saat impor. */
export function summarizeSkill(skill: Skill): Record<string, unknown> {
  return {
    id: skill.id,
    name: skill.name,
    dirName: skill.dirName,
    contentHash: skill.contentHash,
    source: skill.source,
    importedAt: skill.importedAt,
    ...(skill.license === undefined ? {} : { license: skill.license }),
  };
}

/** Ratakan pohon hasil inspect menjadi daftar file; direktori hanya dilewati. */
function flatten(nodes: readonly InspectNode[], result: SkillFileView[] = []): SkillFileView[] {
  for (const node of nodes) {
    if (node.kind === "directory") {
      flatten(node.children ?? [], result);
      continue;
    }
    result.push({
      path: node.path,
      bytes: node.size,
      ...(node.kind === "symlink" ? { risk: "symlink" } : {}),
    });
  }
  return result;
}

/** Bentuk `risky` pada respons pratinjau (spec §13: penanda risiko sebelum konfirmasi). */
function riskyOf(inspect: InspectResult): {
  scripts: boolean;
  binary: boolean;
  escapingSymlink: boolean;
  messages: readonly string[];
} {
  return {
    scripts: inspect.hasScriptsDir,
    binary: inspect.hasBinary,
    escapingSymlink: inspect.hasEscapingSymlink,
    messages: inspect.risks,
  };
}

/** Cari skill berdasarkan nama atau id; tidak ada = 404 skill_not_found. */
export async function findSkill(deps: ServerDeps, name: string): Promise<Skill> {
  const { skill } = await findLibrarySkill(deps.fs, deps.dataRoot, name);
  return skill;
}

/** Folder isi skill di Library, setelah dipastikan tetap di dalam Library. */
export function skillDirectory(deps: ServerDeps, skill: Skill): string {
  const root = libraryRoot(deps.dataRoot);
  const directory = path.join(root, skill.dirName);
  if (!isPathInside(root, directory)) {
    throw new SkillManagerError({
      code: "invalid_path",
      message: `Nama folder skill "${skill.dirName}" menunjuk keluar Library.`,
      details: { path: directory },
    });
  }
  return directory;
}

const inspectSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("folder"), path: z.string().min(1) }),
  z.object({
    type: z.literal("git"),
    url: z.string().min(1),
    ref: z.string().min(1).optional(),
    subdir: z.string().min(1).optional(),
  }),
  z.object({ type: z.literal("zip"), path: z.string().min(1) }),
]);

const importSchema = z.union([
  z.object({ stagingId: z.string().min(1) }),
  z.object({ type: z.literal("folder"), path: z.string().min(1) }),
]);

/** GET /api/skills dan GET /api/skills/:name (kontrak §7). */
export function registerSkillRoutes(app: Hono, deps: ServerDeps): void {
  // Sisa staging proses yang mati dibuang saat pratinjau pertama dipakai, bukan
  // saat startup: AC-10 melarang server menyentuh disk sebelum ada request.
  let stagingCleaned = false;
  const cleanStagingOnce = async (): Promise<void> => {
    if (stagingCleaned) {
      return;
    }
    stagingCleaned = true;
    await cleanStaleStaging(deps.fs, deps.dataRoot);
  };

  app.get("/api/skills", async (c) => {
    const { state } = await loadState(deps.fs, deps.dataRoot);
    return c.json({ skills: state.library.map((skill) => summarizeSkill(skill)) });
  });

  app.get("/api/skills/:name", async (c) => {
    const parsed = nameSchema.safeParse(c.req.param("name"));
    if (!parsed.success) {
      throw new SkillManagerError({
        code: "bad_request",
        message: "Nama skill pada URL tidak valid.",
        details: { issues: parsed.error.issues.map((issue) => issue.message) },
      });
    }

    const skill = await findSkill(deps, parsed.data);
    const directory = skillDirectory(deps, skill);
    const inspected = await inspectSource(deps.fs, directory);
    const planned = await planDependencies(deps.fs, directory, {
      dataRoot: deps.dataRoot,
      skillId: skill.dirName,
    });

    return c.json({
      skill: {
        ...summarizeSkill(skill),
        ...(skill.license === undefined && inspected.license === undefined
          ? {}
          : { license: skill.license ?? inspected.license }),
        // Provenance sudah utuh di `source` (dari summarizeSkill); field
        // terpisah di sini hanya akan menduplikasi objek yang sama.
        files: flatten(inspected.files),
        ...(planned.ok ? { dependencies: planned.value } : {}),
      },
    });
  });

  app.post("/api/skills/inspect", async (c) => {
    const body = await readJson(c, inspectSchema);
    await cleanStagingOnce();

    let staged: StagedSource;
    try {
      if (body.type === "folder") {
        staged = await stageFromFolder(deps.fs, deps.dataRoot, body.path);
      } else if (body.type === "git") {
        staged = await stageFromGit(
          deps.fs,
          deps.dataRoot,
          deps.runner,
          body.ref === undefined && body.subdir === undefined
            ? { url: body.url }
            : {
                url: body.url,
                ...(body.ref === undefined ? {} : { ref: body.ref }),
                ...(body.subdir === undefined ? {} : { subdir: body.subdir }),
              },
        );
      } else {
        staged = await stageFromZip(deps.fs, deps.dataRoot, body.path);
      }
    } catch (error) {
      // stageFromFolder melempar FsError mentah; Hono hanya meneruskan Error.
      throw asDomainError(error);
    }

    return c.json({
      stagingId: staged.stagingId,
      files: staged.inspect.files,
      risky: riskyOf(staged.inspect),
      totalBytes: staged.inspect.totalBytes,
      ...(staged.inspect.license === undefined ? {} : { license: staged.inspect.license }),
      suggestedName: staged.suggestedName,
      provenance: staged.provenance,
    });
  });

  app.post("/api/skills/import", async (c) => {
    const body = await readJson(c, importSchema);
    const imported =
      "stagingId" in body
        ? await importStaged(deps.fs, deps.dataRoot, body.stagingId)
        : await importFolderSkill(deps.fs, deps.dataRoot, { sourceDir: body.path });
    return c.json({ skill: summarizeSkill(imported.skill) }, 201);
  });
}
