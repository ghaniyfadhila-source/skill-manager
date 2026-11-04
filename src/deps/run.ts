import path from "node:path";
import { SkillManagerError } from "../core/errors.js";
import type { DepCommand, DepKind } from "../core/types.js";
import type { ProcessRunner } from "../fs/process.js";
import { type FileSystem, type FsResult, fsOk } from "../fs/types.js";
import { assertDependencyTools } from "./availability.js";
import { planDependencies } from "./plan.js";

/** Batas waktu satu perintah install; jauh lebih longgar dari verifikasi binary. */
export const DEFAULT_INSTALL_TIMEOUT_MS = 5 * 60_000;

/** Manifest yang harus ada di cwd isolasi agar perintah install bermakna. */
const MANIFESTS: Record<DepKind, readonly string[]> = {
  npm: ["package.json"],
  uv: ["requirements.txt", "pyproject.toml"],
};

export interface RunDependenciesOptions {
  readonly fs: FileSystem;
  readonly runner: ProcessRunner;
  readonly dataRoot: string;
  readonly skillId: string;
  /** Folder isi skill di Library yang manifest-nya dibaca dan disalin. */
  readonly skillDir: string;
  readonly allowScripts?: boolean;
  readonly platform?: NodeJS.Platform;
  readonly timeoutMs?: number;
}

export interface DependencyRunResult {
  readonly kind: DepKind;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface DependencyRunReport {
  readonly ok: boolean;
  readonly results: readonly DependencyRunResult[];
}

async function stageManifests(
  fs: FileSystem,
  skillDir: string,
  cwd: string,
  kind: DepKind,
): Promise<FsResult<void>> {
  const created = await fs.mkdir(cwd, { recursive: true });
  if (!created.ok) {
    return created;
  }
  for (const name of MANIFESTS[kind]) {
    const source = path.join(skillDir, name);
    const stat = await fs.stat(source);
    if (!stat.ok || stat.value.kind !== "file") {
      continue;
    }
    const text = await fs.readText(source);
    if (!text.ok) {
      return text;
    }
    const written = await fs.write(path.join(cwd, name), text.value);
    if (!written.ok) {
      return written;
    }
  }
  return fsOk(undefined);
}

function wrap(error: { code: string; message: string }, details: unknown): SkillManagerError {
  return new SkillManagerError({ code: error.code, message: error.message, details });
}

/**
 * Jalankan rencana dependensi. HANYA boleh dipanggil eksplisit setelah user
 * mengonfirmasi perintah yang ditampilkan (spec §10.6 poin 3, AC-10).
 */
export async function runDependencies(
  options: RunDependenciesOptions,
): Promise<DependencyRunReport> {
  const planned = await planDependencies(options.fs, options.skillDir, options);
  if (!planned.ok) {
    throw wrap(planned.error, planned.error);
  }
  const commands = planned.value;
  if (commands.length === 0) {
    return { ok: true, results: [] };
  }

  await assertDependencyTools(
    options.runner,
    commands.map((command: DepCommand) => command.kind),
  );

  const timeoutMs = options.timeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS;
  const results: DependencyRunResult[] = [];
  for (const command of commands) {
    const staged = await stageManifests(options.fs, options.skillDir, command.cwd, command.kind);
    if (!staged.ok) {
      throw wrap(staged.error, staged.error);
    }
    const execution = await options.runner.run(command.command, command.args, {
      cwd: command.cwd,
      timeoutMs,
    });
    if (!execution.ok) {
      throw new SkillManagerError({
        code: "dependency_run_failed",
        message: execution.error.message,
        details: execution.error,
      });
    }
    results.push({
      kind: command.kind,
      command: command.command,
      args: command.args,
      cwd: command.cwd,
      code: execution.value.code,
      stdout: execution.value.stdout,
      stderr: execution.value.stderr,
      timedOut: execution.value.timedOut,
    });
  }

  return { ok: results.every((result) => result.code === 0 && !result.timedOut), results };
}
