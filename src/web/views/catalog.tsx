import { useState } from "react";
import { targetColumns } from "../model.js";
import type { CatalogItem, HarnessInfo } from "../types.js";
import { EmptyState, Spinner } from "../ui.js";

export interface CatalogViewProps {
  readonly items: readonly CatalogItem[];
  readonly harnesses: readonly HarnessInfo[];
  readonly loading: boolean;
  readonly error: string | null;
  /** Kunci item yang sedang diproses; tombol lain ikut dimatikan. */
  readonly busyKey: string | null;
  readonly onInstall: (item: CatalogItem, targetId: string) => void;
}

function starsLabel(stars: number | undefined): string | null {
  return stars === undefined ? null : `${stars.toLocaleString("id-ID")} bintang`;
}

function CatalogCard({
  item,
  targets,
  busy,
  onInstall,
}: {
  item: CatalogItem;
  targets: readonly string[];
  busy: boolean;
  onInstall: (item: CatalogItem, targetId: string) => void;
}) {
  const [target, setTarget] = useState<string>(targets[0] ?? "");
  const canInstall = targets.length > 0 && !busy;

  return (
    <article className="flex flex-col justify-between gap-3 rounded-lg border border-slate-800 p-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-slate-100">{item.name}</h2>
          {item.installed && (
            <span className="rounded-full border border-emerald-500/60 bg-emerald-950/60 px-2 py-0.5 text-xs text-emerald-200">
              terpasang
            </span>
          )}
        </div>
        <p className="font-mono text-xs text-slate-400">
          {item.owner}/{item.repo}
        </p>
        <p className="text-sm text-slate-300">{item.description}</p>
        <p className="text-xs text-slate-500">
          {starsLabel(item.stars) ?? "bintang tidak tersedia (offline)"}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`target-${item.id}`}>
          Harness untuk {item.name}
        </label>
        <select
          id={`target-${item.id}`}
          value={target}
          disabled={busy}
          onChange={(event) => {
            setTarget(event.target.value);
          }}
          className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm disabled:opacity-50"
        >
          {targets.length === 0 ? (
            <option value="">Belum ada harness managed</option>
          ) : (
            targets.map((targetId) => (
              <option key={targetId} value={targetId}>
                {targetId}
              </option>
            ))
          )}
        </select>
        <button
          type="button"
          disabled={!canInstall}
          onClick={() => {
            onInstall(item, target);
          }}
          className="rounded bg-teal-600 px-3 py-1 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
        >
          Pasang
        </button>
      </div>
    </article>
  );
}

/** Katalog skill terkurasi dari GitHub; satu klik pasang ke harness pilihan. */
export function CatalogView({
  items,
  harnesses,
  loading,
  error,
  busyKey,
  onInstall,
}: CatalogViewProps) {
  const targets = targetColumns(harnesses).map((column) => column.id);

  return (
    <section aria-labelledby="catalog-title" className="space-y-4">
      <h1 id="catalog-title" className="text-2xl font-semibold">
        Katalog
      </h1>
      <p className="text-sm text-slate-400">
        Skill terpercaya yang sedang populer di GitHub. Pilih harness, lalu Pasang — skill terunduh,
        diimpor, dan dipasang tanpa perintah manual.
      </p>

      {error !== null && (
        <p role="alert" className="rounded border border-rose-500/60 bg-rose-950/40 p-3 text-sm">
          {error}
        </p>
      )}

      {loading ? (
        <Spinner label="Memuat katalog…" />
      ) : items.length === 0 ? (
        <EmptyState title="Katalog kosong.">Server tidak mengembalikan item katalog.</EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {items.map((item) => (
            <CatalogCard
              key={item.id}
              item={item}
              targets={targets}
              busy={busyKey !== null}
              onInstall={onInstall}
            />
          ))}
        </div>
      )}

      {targets.length === 0 && !loading && (
        <p className="text-sm text-amber-300">
          Belum ada harness managed terdeteksi — tombol Pasang tidak aktif sampai ada Target di
          halaman Harnesses.
        </p>
      )}
    </section>
  );
}
