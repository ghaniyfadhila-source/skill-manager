import { driftLabel, formatBytes, sourceLabel } from "../model.js";
import type { InstallationView, SkillDetail } from "../types.js";
import { Chip, EmptyState, Spinner } from "../ui.js";

export interface SkillDetailViewProps {
  readonly skill: SkillDetail | null;
  readonly name: string;
  readonly installations: readonly InstallationView[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly onBack: () => void;
}

/** Detail skill: isi folder, provenance, lisensi, dependensi, riwayat pasang/cabut. */
export function SkillDetailView({
  skill,
  name,
  installations,
  loading,
  error,
  onBack,
}: SkillDetailViewProps) {
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">{skill?.name ?? name}</h1>
      <button
        type="button"
        onClick={onBack}
        className="rounded border border-slate-600 px-3 py-1 text-sm hover:bg-slate-800"
      >
        Kembali ke Skills
      </button>
    </div>
  );

  if (loading) {
    return (
      <section className="space-y-4">
        {header}
        <Spinner label="Memuat detail skill…" />
      </section>
    );
  }

  if (error !== null) {
    return (
      <section className="space-y-4">
        {header}
        <p role="alert" className="rounded border border-rose-500/60 bg-rose-950/40 p-3 text-sm">
          {error}
        </p>
      </section>
    );
  }

  if (skill === null) {
    return (
      <section className="space-y-4">
        {header}
        <EmptyState title={`Skill "${name}" tidak ditemukan di Library.`}>
          Mungkin skill sudah dihapus atau namanya berubah. Kembali ke daftar Skills untuk melihat
          isi Library saat ini.
        </EmptyState>
      </section>
    );
  }

  const files = skill.files ?? [];
  const dependencies = skill.dependencies ?? [];
  const history = installations.filter(
    (installation) =>
      installation.skillId === skill.id ||
      (installation.skillId === undefined && installation.skillName === skill.name),
  );

  return (
    <section className="space-y-6">
      {header}

      <dl className="grid gap-3 rounded-lg border border-slate-800 p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sumber</dt>
          <dd className="font-mono text-xs">{sourceLabel(skill.source)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Lisensi</dt>
          <dd>{skill.license ?? "tidak terdeteksi saat impor"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Provenance
          </dt>
          <dd className="break-all font-mono text-xs">{skill.provenance ?? "-"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Hash & waktu impor
          </dt>
          <dd className="break-all font-mono text-xs">
            {skill.contentHash ?? "-"} · {skill.importedAt ?? "-"}
          </dd>
        </div>
      </dl>

      <section aria-labelledby="detail-files" className="space-y-2">
        <h2 id="detail-files" className="text-lg font-medium">
          Isi folder <span className="text-slate-400">({files.length} berkas)</span>
        </h2>
        {files.length === 0 ? (
          <p className="text-sm text-slate-400">Server tidak melaporkan isi folder.</p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 font-mono text-xs">
            {files.map((file) => (
              <li key={file.path} className="flex flex-wrap items-center justify-between gap-2 p-2">
                <span className="break-all">{file.path}</span>
                <span className="flex items-center gap-2 text-slate-400">
                  {formatBytes(file.bytes)}
                  {file.risk !== undefined && file.risk !== null && (
                    <Chip tone="warn">
                      <span aria-hidden="true">!</span> risiko: {file.risk}
                    </Chip>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="detail-deps" className="space-y-2">
        <h2 id="detail-deps" className="text-lg font-medium">
          Dependensi
        </h2>
        {dependencies.length === 0 ? (
          <p className="text-sm text-slate-400">
            Tidak ada dependensi. Tidak ada perintah yang akan dijalankan.
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {dependencies.map((dependency) => (
              <li
                key={`${dependency.command} ${(dependency.args ?? []).join(" ")}`}
                className="rounded-lg border border-slate-800 p-3"
              >
                <p className="font-mono text-xs">
                  {dependency.command} {(dependency.args ?? []).join(" ")}
                </p>
                {dependency.reason !== undefined && (
                  <p className="mt-1 text-xs text-slate-400">{dependency.reason}</p>
                )}
                {(dependency.dependencies ?? []).length > 0 && (
                  <p className="mt-1 text-xs text-slate-300">
                    paket: {(dependency.dependencies ?? []).join(", ")}
                  </p>
                )}
                <p className="mt-1 text-xs text-amber-300">
                  Tidak dijalankan otomatis — butuh konfirmasi di halaman Skills.
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="detail-history" className="space-y-2">
        <h2 id="detail-history" className="text-lg font-medium">
          Riwayat pasang/cabut
        </h2>
        {history.length === 0 ? (
          <p className="text-sm text-slate-400">Belum pernah dipasang ke Target mana pun.</p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 text-sm">
            {history.map((installation) => (
              <li key={installation.targetId} className="flex flex-wrap justify-between gap-2 p-3">
                <span className="font-mono text-xs">{installation.targetId}</span>
                <span className="text-xs text-slate-400">
                  {driftLabel(installation.drift ?? "clean")} · dipasang{" "}
                  {installation.installedAt ?? "waktu tidak dicatat"} · mode{" "}
                  {installation.mode ?? "copy"}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-slate-500">
          Histori lengkap (termasuk cabut) hanya tersimpan bila server mencatatnya; v0.1 menyimpan
          Installation yang masih aktif.
        </p>
      </section>
    </section>
  );
}
