import type { DoctorReport, DriftEntry } from "../types.js";
import { EmptyState } from "../ui.js";

export interface DoctorViewProps {
  readonly report: DoctorReport;
  readonly onRefresh: () => void;
  /** Konfirmasi dampak dilakukan App sebelum endpoint temp dipanggil. */
  readonly onCleanTemp: () => void;
  readonly busy?: boolean;
}

function EntryList({
  id,
  title,
  entries,
}: {
  id: string;
  title: string;
  entries: readonly DriftEntry[];
}) {
  return (
    <section aria-labelledby={`doctor-${id}`} className="space-y-2">
      <h2 id={`doctor-${id}`} className="text-lg font-medium">
        {title} <span className="text-slate-400">({entries.length})</span>
      </h2>
      {entries.length === 0 ? (
        <p className="text-sm text-slate-400">Tidak ada.</p>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 text-sm">
          {entries.map((entry) => (
            <li
              key={`${entry.skillId ?? entry.skillName ?? "entri"}::${entry.storeId ?? ""}::${entry.path ?? ""}`}
              className="p-3"
            >
              <p className="font-medium">{entry.skillName ?? "(tanpa nama)"}</p>
              <p className="font-mono text-xs text-slate-400">
                {entry.path ?? entry.storeId ?? "-"}
              </p>
              {entry.behindLibrary === true && (
                <p className="text-xs text-amber-300">Tertinggal dari Library (hash berbeda).</p>
              )}
              {entry.error?.message !== undefined && (
                <p className="text-xs text-rose-300">{entry.error.message}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function DoctorView({ report, onRefresh, onCleanTemp, busy = false }: DoctorViewProps) {
  const problemCount =
    report.missing.length + report.unmanaged.length + report.stale.length + report.tempDirs.length;

  return (
    <section aria-labelledby="doctor-title" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="doctor-title" className="text-2xl font-semibold">
          Doctor
        </h1>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={busy}
            className="rounded border border-slate-600 px-3 py-1 text-sm hover:bg-slate-800 disabled:opacity-60"
          >
            Periksa ulang
          </button>
          <button
            type="button"
            onClick={onCleanTemp}
            disabled={busy || report.tempDirs.length === 0}
            className="rounded bg-amber-500 px-3 py-1 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
          >
            Bersihkan direktori temp ({report.tempDirs.length})
          </button>
        </div>
      </div>

      {problemCount === 0 ? (
        <EmptyState title="Tidak ada masalah yang terdeteksi.">
          Library, Store, dan sisa direktori sementara bersih. Jalankan Periksa ulang setelah
          mengubah isi Store.
        </EmptyState>
      ) : (
        <p className="text-sm text-slate-300">
          {problemCount} temuan. Membersihkan direktori temp hanya menghapus folder sementara
          <code className="mx-1 font-mono">.skill-manager-tmp-*</code> di Store.
        </p>
      )}

      <EntryList id="missing" title="Installation hilang" entries={report.missing} />
      <EntryList id="unmanaged" title="Direktori tidak terkelola" entries={report.unmanaged} />
      <EntryList id="stale" title="Tertinggal dari Library" entries={report.stale} />

      <section aria-labelledby="doctor-temp" className="space-y-2">
        <h2 id="doctor-temp" className="text-lg font-medium">
          Direktori sementara <span className="text-slate-400">({report.tempDirs.length})</span>
        </h2>
        {report.tempDirs.length === 0 ? (
          <p className="text-sm text-slate-400">Tidak ada sisa direktori sementara.</p>
        ) : (
          <ul className="list-disc space-y-1 rounded-lg border border-slate-800 p-3 pl-7 font-mono text-xs">
            {report.tempDirs.map((dir) => (
              <li key={dir}>{dir}</li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
