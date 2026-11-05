import { useState } from "react";
import { formatBytes, sourceLabel } from "../model.js";
import type { InspectRequest, InspectResult } from "../types.js";
import { Chip, EmptyState, ErrorBanner, Spinner } from "../ui.js";

/**
 * Layar impor (spec 13). Dua langkah dan sengaja tidak bisa dipersingkat:
 * sumber diunduh ke staging lebih dulu, isinya ditampilkan beserta penanda
 * risiko, dan baru setelah itu user memutuskan. Tanpa pratinjau, memasang
 * skill dari jaringan berarti menyimpan kode yang belum pernah dilihat.
 */
interface ImportViewProps {
  readonly staged: InspectResult | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onInspect: (input: InspectRequest) => void;
  readonly onImport: () => void;
  readonly onReset: () => void;
}

const TYPES = [
  { value: "folder", label: "Folder lokal" },
  { value: "git", label: "URL git" },
  { value: "zip", label: "Berkas zip" },
] as const;

const RISK_LABELS = [
  { key: "scripts", text: "berisi skrip" },
  { key: "binary", text: "berisi berkas biner" },
  { key: "escapingSymlink", text: "ada symlink keluar folder" },
] as const;

export function ImportView({ staged, busy, error, onInspect, onImport, onReset }: ImportViewProps) {
  const [type, setType] = useState<InspectRequest["type"]>("folder");
  const [value, setValue] = useState("");
  const [ref, setRef] = useState("");

  if (error !== null) {
    return (
      <section className="space-y-4">
        <ErrorBanner title="Gagal memeriksa sumber" message={error} />
        <button
          type="button"
          className="rounded border border-slate-700 px-3 py-2 text-sm"
          onClick={onReset}
        >
          Coba lagi
        </button>
      </section>
    );
  }

  if (busy) {
    return <Spinner label="Mengunduh dan memeriksa isi sumber..." />;
  }

  if (staged !== null) {
    return <PreviewBody staged={staged} onImport={onImport} onReset={onReset} />;
  }

  const placeholder =
    type === "git"
      ? "https://github.com/user/skill.git"
      : type === "zip"
        ? "C:\\unduhan\\skill.zip"
        : "C:\\skills\\skill-baru";

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Impor skill</h2>
      <p className="text-sm text-slate-400">
        Sumber diunduh ke staging lebih dulu, bukan langsung ke Library. Isinya diperiksa dan
        ditampilkan sebelum apa pun disimpan.
      </p>

      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = value.trim();
          if (trimmed.length === 0) {
            return;
          }
          onInspect(
            type === "git"
              ? { type, url: trimmed, ...(ref.trim() === "" ? {} : { ref: ref.trim() }) }
              : { type, path: trimmed },
          );
        }}
      >
        <label className="block text-sm">
          <span className="mb-1 block text-slate-400">Jenis sumber</span>
          <select
            className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"
            value={type}
            aria-label="Jenis sumber"
            onChange={(event) => {
              setType(event.target.value as InspectRequest["type"]);
              setValue("");
            }}
          >
            {TYPES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-slate-400">
            {type === "git" ? "URL repositori" : type === "zip" ? "Path berkas zip" : "Path folder"}
          </span>
          <input
            className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs"
            value={value}
            placeholder={placeholder}
            aria-label={type === "git" ? "URL repositori" : "Path sumber"}
            onChange={(event) => {
              setValue(event.target.value);
            }}
          />
        </label>

        {type === "git" ? (
          <label className="block text-sm">
            <span className="mb-1 block text-slate-400">Ref (opsional)</span>
            <input
              className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs"
              value={ref}
              placeholder="main atau tag"
              aria-label="Ref git"
              onChange={(event) => {
                setRef(event.target.value);
              }}
            />
          </label>
        ) : null}

        <button
          type="submit"
          className="rounded bg-sky-600 px-3 py-2 text-sm font-medium disabled:opacity-50"
          disabled={value.trim().length === 0}
        >
          Periksa isi
        </button>
      </form>
    </section>
  );
}

/** Pratinjau: pohon berkas, ukuran, lisensi, dan penanda risiko sebelum impor. */
function PreviewBody({
  staged,
  onImport,
  onReset,
}: {
  readonly staged: InspectResult;
  readonly onImport: () => void;
  readonly onReset: () => void;
}) {
  const files = staged.files ?? [];
  const risky = staged.risky;
  const flags = RISK_LABELS.filter((entry) => risky?.[entry.key] === true);
  const messages = risky?.messages ?? [];
  const importLabel = "Impor " + (staged.suggestedName ?? "skill") + " ke Library";

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Pratinjau isi</h2>

      <dl className="grid gap-2 rounded-lg border border-slate-800 p-4 text-sm sm:grid-cols-2">
        <Row label="Nama yang diusulkan" value={staged.suggestedName ?? "(tidak terdeteksi)"} />
        <Row label="Ukuran" value={formatBytes(staged.totalBytes)} />
        <Row label="Lisensi" value={staged.license ?? "tidak terdeteksi"} />
        <Row label="Asal" value={sourceLabel(staged.provenance)} />
      </dl>

      {flags.length === 0 && messages.length === 0 ? (
        <p className="text-sm text-emerald-400">
          Tidak ada penanda risiko: tanpa skrip, tanpa biner, tanpa symlink keluar folder.
        </p>
      ) : (
        <div className="space-y-2 rounded-lg border border-amber-700 bg-amber-950/40 p-4">
          <p className="text-sm font-semibold text-amber-300">Periksa sebelum memasang:</p>
          <ul className="list-inside list-disc text-sm text-amber-200">
            {flags.map((entry) => (
              <li key={entry.key}>{entry.text}</li>
            ))}
            {messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {files.length === 0 ? (
        <EmptyState title="Tidak ada berkas terbaca">
          <span>Sumber ini kosong.</span>
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-3 py-2">Berkas</th>
                <th className="px-3 py-2">Ukuran</th>
                <th className="px-3 py-2">Risiko</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.path} className="border-t border-slate-800">
                  <td className="px-3 py-1 font-mono text-xs">{file.path}</td>
                  <td className="px-3 py-1 text-xs">{formatBytes(file.bytes)}</td>
                  <td className="px-3 py-1">
                    {file.risk ? (
                      <Chip tone="warn">{file.risk}</Chip>
                    ) : (
                      <span className="text-slate-500">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          className="rounded bg-sky-600 px-3 py-2 text-sm font-medium"
          onClick={onImport}
        >
          {importLabel}
        </button>
        <button
          type="button"
          className="rounded border border-slate-700 px-3 py-2 text-sm"
          onClick={onReset}
        >
          Batalkan
        </button>
      </div>

      <p className="text-xs text-slate-500">
        Staging dibuang setelah impor, berhasil maupun gagal. Skill yang masuk Library belum
        terpasang ke harness mana pun.
      </p>
    </section>
  );
}

function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="font-mono text-xs">{value}</dd>
    </div>
  );
}
