import { driftIsProblem, driftLabel, sourceLabel, targetsOf } from "../model.js";
import type { HarnessInfo, InstallationView, SkillSummary } from "../types.js";
import { Chip } from "../ui.js";

export interface SkillsViewProps {
  readonly skills: readonly SkillSummary[];
  readonly installations: readonly InstallationView[];
  readonly harnesses: readonly HarnessInfo[];
  readonly onOpen: (skillName: string) => void;
}

/** Label Target yang ramah; jatuh kembali ke id Target bila harness belum dikenal. */
export function targetLabel(harnesses: readonly HarnessInfo[], targetId: string): string {
  for (const harness of harnesses) {
    for (const target of harness.targets ?? []) {
      if (target.id === targetId) {
        return target.label ?? targetId;
      }
    }
  }
  return targetId;
}

export function SkillsView({ skills, installations, harnesses, onOpen }: SkillsViewProps) {
  if (skills.length === 0) {
    return (
      <section aria-labelledby="skills-title" className="space-y-4">
        <h1 id="skills-title" className="text-2xl font-semibold">
          Skills
        </h1>
        <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-6">
          <p className="font-medium text-slate-100">Belum ada skill di Library.</p>
          <p className="mt-2 text-sm text-slate-400">
            Tambahkan skill lewat CLI:{" "}
            <code className="font-mono">skill-manager add &lt;folder|url|zip&gt;</code> lalu tekan
            Muat ulang. Skill yang sudah masuk akan muncul di sini dengan chip Target dan status
            drift-nya.
          </p>
          <p className="mt-2 text-sm text-slate-400">
            Belum ada harness? Buka halaman Harnesses untuk melihat hasil deteksi.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="skills-title" className="space-y-4">
      <h1 id="skills-title" className="text-2xl font-semibold">
        Skills
      </h1>
      <p className="text-sm text-slate-400">
        {skills.length} skill di Library. Klik nama skill untuk melihat isi folder, provenance, dan
        riwayat pasang/cabut.
      </p>
      <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
        {skills.map((skill) => {
          const placed = targetsOf(installations, skill);
          return (
            <li key={skill.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => {
                    onOpen(skill.name);
                  }}
                  className="text-left font-medium text-teal-300 underline-offset-2 hover:underline"
                  aria-label={`Buka detail ${skill.name}`}
                >
                  {skill.name}
                </button>
                <p className="mt-1 text-xs text-slate-400">{sourceLabel(skill.source)}</p>
                {skill.license !== undefined && (
                  <p className="text-xs text-slate-500">lisensi: {skill.license}</p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {placed.length === 0 ? (
                  <Chip>belum terpasang di Target mana pun</Chip>
                ) : (
                  placed.map((installation) => (
                    <Chip
                      key={installation.targetId}
                      tone={driftIsProblem(installation.drift ?? "clean") ? "warn" : "ok"}
                    >
                      <span aria-hidden="true">
                        {driftIsProblem(installation.drift ?? "clean") ? "!" : "\u2713"}
                      </span>
                      {targetLabel(harnesses, installation.targetId)} ·{" "}
                      {driftLabel(installation.drift ?? "clean")}
                    </Chip>
                  ))
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
