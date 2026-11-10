import { cellFor, driftIsProblem, targetColumns } from "../model.js";
import type { HarnessInfo, InstallationView, SkillSummary } from "../types.js";
import { EmptyState } from "../ui.js";

export interface MatrixViewProps {
  readonly skills: readonly SkillSummary[];
  readonly installations: readonly InstallationView[];
  readonly harnesses: readonly HarnessInfo[];
  /** `installed` menentukan aksi: pasang bila sel kosong, cabut bila terisi. */
  readonly onToggle: (skillName: string, targetId: string, installed: boolean) => void;
  readonly busyKey?: string | null;
}

/**
 * Grid skill x Target managed. Satu klik = satu aksi, tetapi aksi tetap melewati
 * konfirmasi di App (AC-6) — sel hanya memicu permintaan, bukan langsung menulis.
 */
export function MatrixView({
  skills,
  installations,
  harnesses,
  onToggle,
  busyKey = null,
}: MatrixViewProps) {
  const columns = targetColumns(harnesses);

  if (columns.length === 0) {
    return (
      <section aria-labelledby="matrix-title" className="space-y-4">
        <h1 id="matrix-title" className="text-2xl font-semibold">
          Matrix
        </h1>
        <EmptyState title="Belum ada Target managed untuk ditampilkan.">
          Matrix butuh minimal satu harness dengan tingkat kemampuan managed. Buka halaman{" "}
          <a href="#/harnesses" className="text-teal-300 underline">
            Harnesses
          </a>{" "}
          untuk melihat hasil deteksi dan menekan Recheck.
        </EmptyState>
      </section>
    );
  }

  if (skills.length === 0) {
    return (
      <section aria-labelledby="matrix-title" className="space-y-4">
        <h1 id="matrix-title" className="text-2xl font-semibold">
          Matrix
        </h1>
        <EmptyState title="Belum ada skill untuk dipetakan.">
          Tambahkan skill lewat CLI lalu buka halaman{" "}
          <a href="#/skills" className="text-teal-300 underline">
            Skills
          </a>
          .
        </EmptyState>
      </section>
    );
  }

  return (
    <section aria-labelledby="matrix-title" className="space-y-3">
      <h1 id="matrix-title" className="text-2xl font-semibold">
        Matrix
      </h1>
      <p className="text-sm text-slate-400">
        Klik sel untuk memasang atau mencabut. Setiap aksi destruktif lebih dulu menampilkan
        konfirmasi berisi dampaknya.
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Grid skill dan Target managed</caption>
          <thead>
            <tr className="bg-slate-900">
              <th scope="col" className="p-3 text-left font-semibold">
                Skill
              </th>
              {columns.map((column) => (
                <th key={column.id} scope="col" className="p-3 text-left font-semibold">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {skills.map((skill) => (
              <tr key={skill.id} className="border-t border-slate-800">
                <th scope="row" className="p-3 text-left font-medium">
                  {skill.name}
                </th>
                {columns.map((column) => {
                  const cell = cellFor(installations, skill, column.id);
                  const key = `${skill.name}::${column.id}`;
                  const label = cell.installed
                    ? `Cabut ${skill.name} dari ${column.label} (terpasang)`
                    : `Pasang ${skill.name} ke ${column.label} (belum terpasang)`;
                  return (
                    <td key={column.id} className="p-2">
                      <button
                        type="button"
                        aria-label={label}
                        aria-busy={busyKey === key}
                        disabled={busyKey !== null}
                        onClick={() => {
                          onToggle(skill.name, column.id, cell.installed);
                        }}
                        className={`w-full rounded border px-2 py-1 text-left text-xs ${
                          cell.installed
                            ? driftIsProblem(cell.status)
                              ? "border-amber-500/60 bg-amber-950/40 text-amber-100"
                              : "border-emerald-500/60 bg-emerald-950/40 text-emerald-100"
                            : "border-slate-700 bg-slate-900 text-slate-400 hover:bg-slate-800"
                        }`}
                      >
                        <span aria-hidden="true">
                          {cell.installed ? (driftIsProblem(cell.status) ? "! " : "\u2713 ") : "+ "}
                        </span>
                        {cell.label}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
