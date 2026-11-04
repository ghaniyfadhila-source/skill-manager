import type {
  DriftStatus,
  HarnessInfo,
  InstallationView,
  SkillSummary,
  SourceInfo,
} from "./types.js";

/** Kolom matriks: hanya Target yang bisa dipasangi (capability `managed`). */
export interface MatrixColumn {
  readonly id: string;
  readonly label: string;
}

export type CellStatus = DriftStatus | "absent";

export interface CellState {
  readonly installed: boolean;
  readonly status: CellStatus;
  readonly label: string;
}

/**
 * Turunkan daftar Target managed dari hasil `GET /api/harnesses`.
 *
 * Server boleh menyebut target eksplisit (`targets[]`); bila tidak, UI memakai
 * `<harnessId>/global` yang merupakan satu-satunya scope v0.1 (spec §5.1).
 */
export function targetColumns(harnesses: readonly HarnessInfo[]): MatrixColumn[] {
  const columns = new Map<string, MatrixColumn>();
  for (const harness of harnesses) {
    if (harness.capability !== "managed") {
      continue;
    }
    const declared = harness.targets ?? [];
    if (declared.length === 0) {
      columns.set(`${harness.id}/global`, { id: `${harness.id}/global`, label: harness.name });
      continue;
    }
    for (const target of declared) {
      if (target.id === "" || columns.has(target.id)) {
        continue;
      }
      columns.set(target.id, { id: target.id, label: target.label ?? target.id });
    }
  }
  return [...columns.values()];
}

function belongsTo(installation: InstallationView, skill: SkillSummary): boolean {
  if (installation.skillId !== undefined && installation.skillId !== "") {
    return installation.skillId === skill.id;
  }
  return installation.skillName === skill.name;
}

export function installationFor(
  installations: readonly InstallationView[],
  skill: SkillSummary,
  targetId: string,
): InstallationView | undefined {
  return installations.find(
    (installation) => installation.targetId === targetId && belongsTo(installation, skill),
  );
}

/**
 * Status satu sel matriks. Teks selalu disertakan supaya drift tidak dibedakan
 * hanya lewat warna (WCAG 1.4.1).
 */
export function cellFor(
  installations: readonly InstallationView[],
  skill: SkillSummary,
  targetId: string,
): CellState {
  const installation = installationFor(installations, skill, targetId);
  if (installation === undefined) {
    return { installed: false, status: "absent", label: "Tidak terpasang" };
  }
  const status = installation.drift ?? "clean";
  return { installed: true, status, label: driftLabel(status) };
}

export function driftLabel(status: CellStatus): string {
  switch (status) {
    case "absent":
      return "Tidak terpasang";
    case "clean":
      return "Terpasang";
    case "modified":
      return "Drift: isi berubah";
    case "missing":
      return "Drift: direktori hilang";
    case "unmanaged":
      return "Tidak terkelola";
  }
}

export function driftIsProblem(status: CellStatus): boolean {
  return status === "modified" || status === "missing" || status === "unmanaged";
}

/** Provenance ringkas untuk daftar skill (spec §12: sumber terlihat di baris). */
export function sourceLabel(source: SourceInfo | undefined): string {
  if (source === undefined) {
    return "sumber tidak diketahui";
  }
  if (source.type === "git") {
    const ref = source.ref !== undefined ? `#${source.ref}` : "";
    const commit = source.commit !== undefined ? `@${source.commit.slice(0, 7)}` : "";
    return `git ${source.url ?? "(url tidak dicatat)"}${ref}${commit}`;
  }
  return `${source.type} ${source.path ?? "(path tidak dicatat)"}`;
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return "ukuran tidak diketahui";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Target tempat skill terpasang, untuk chip di layar Skills. */
export function targetsOf(
  installations: readonly InstallationView[],
  skill: SkillSummary,
): InstallationView[] {
  return installations.filter((installation) => belongsTo(installation, skill));
}
