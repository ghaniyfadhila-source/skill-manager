import { SkillManagerError } from "../core/errors.js";
import type { DepKind } from "../core/types.js";
import { DEFAULT_PROCESS_TIMEOUT_MS, type ProcessRunner } from "../fs/process.js";

/** Hasil pemeriksaan satu package manager; tidak pernah melempar. */
export interface ToolAvailability {
  readonly kind: DepKind;
  readonly available: boolean;
  /** Versi yang dilaporkan binary, bila ada. */
  readonly version?: string;
  /** Alasan kegagalan, untuk ditampilkan ke user. */
  readonly message?: string;
}

export interface CheckToolOptions {
  readonly timeoutMs?: number;
}

/**
 * Cek ketersediaan npm/uv lewat `--version` (spec §10.6 poin 5).
 *
 * Hanya memanggil `--version`; tidak pernah memasang package manager.
 */
export async function checkDependencyTool(
  runner: ProcessRunner,
  kind: DepKind,
  options: CheckToolOptions = {},
): Promise<ToolAvailability> {
  const result = await runner.run(kind, ["--version"], {
    timeoutMs: options.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS,
  });
  if (!result.ok) {
    return { kind, available: false, message: result.error.message };
  }
  if (result.value.timedOut) {
    return { kind, available: false, message: `"${kind} --version" melewati batas waktu.` };
  }
  if (result.value.code !== 0) {
    return {
      kind,
      available: false,
      message: `"${kind} --version" keluar dengan kode ${result.value.code ?? "null"}.`,
    };
  }
  const version = (result.value.stdout || result.value.stderr).trim();
  return version.length > 0 ? { kind, available: true, version } : { kind, available: true };
}

/**
 * Pastikan semua package manager yang dibutuhkan tersedia. Bila tidak, berhenti
 * dengan galat jelas — aplikasi tidak pernah memasang package manager sendiri.
 */
export async function assertDependencyTools(
  runner: ProcessRunner,
  kinds: readonly DepKind[],
  options: CheckToolOptions = {},
): Promise<readonly ToolAvailability[]> {
  const unique = [...new Set(kinds)];
  const statuses = await Promise.all(
    unique.map((kind) => checkDependencyTool(runner, kind, options)),
  );
  const missing = statuses.filter((status) => !status.available);
  if (missing.length > 0) {
    const names = missing.map((status) => status.kind).join(" dan ");
    throw new SkillManagerError({
      code: "dependency_tool_missing",
      message: `${names} tidak tersedia. Pasang sendiri lebih dulu; Skill Manager tidak pernah memasang package manager.`,
      details: { missing: missing.map(({ kind, message }) => ({ kind, message })) },
    });
  }
  return statuses;
}
