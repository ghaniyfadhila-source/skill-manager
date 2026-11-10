import type { HarnessInfo } from "../types.js";
import { Chip, EmptyState } from "../ui.js";

export interface HarnessesViewProps {
  readonly harnesses: readonly HarnessInfo[];
  readonly onRecheck: () => void;
  /** Membuka URL resmi harness di tab baru; app TIDAK menjalankan installer (AC-11). */
  readonly onConnect: (harnessId: string) => void;
  readonly busy?: boolean;
  readonly error?: string | null;
}

function CapabilityChip({ capability }: { capability: HarnessInfo["capability"] }) {
  return capability === "managed" ? (
    <Chip tone="ok">
      <span aria-hidden="true">✓</span> managed — bisa dipasang/dicabut
    </Chip>
  ) : (
    <Chip>
      <span aria-hidden="true">○</span> Detected-only — terlihat, tidak bisa dipasangi
    </Chip>
  );
}

export function HarnessesView({
  harnesses,
  onRecheck,
  onConnect,
  busy = false,
  error = null,
}: HarnessesViewProps) {
  const recheckButton = (
    <button
      type="button"
      onClick={onRecheck}
      disabled={busy}
      className="rounded bg-teal-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-400 disabled:opacity-60"
    >
      Recheck
    </button>
  );

  return (
    <section aria-labelledby="harnesses-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="harnesses-title" className="text-2xl font-semibold">
          Harnesses
        </h1>
        {recheckButton}
      </div>
      {error !== null && (
        <p role="alert" className="rounded border border-rose-500/60 bg-rose-950/40 p-3 text-sm">
          {error}
        </p>
      )}

      {harnesses.length === 0 ? (
        <EmptyState title="Belum ada harness terdeteksi.">
          Skill Manager belum menemukan harness yang dikenal di mesin ini. Kalau kamu baru saja
          memasang salah satu harness, tekan Recheck — tidak perlu menyalakan ulang aplikasi.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {harnesses.map((harness) => {
            const installUrl = harness.connect?.installUrl;
            return (
              <li key={harness.id} className="rounded-lg border border-slate-800 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-medium">{harness.name}</h2>
                  <Chip tone={harness.detected ? "ok" : "neutral"}>
                    {harness.detected ? "terdeteksi" : "tidak terdeteksi"}
                  </Chip>
                  <CapabilityChip capability={harness.capability} />
                </div>

                <div className="mt-2 text-sm text-slate-300">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Alasan deteksi
                  </p>
                  {(harness.detectionReasons ?? []).length === 0 ? (
                    <p className="text-slate-400">Server tidak melaporkan alasan deteksi.</p>
                  ) : (
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">
                      {(harness.detectionReasons ?? []).map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  )}
                </div>

                {(harness.storeIds ?? []).length > 0 && (
                  <p className="mt-2 font-mono text-xs text-slate-500">
                    Store: {(harness.storeIds ?? []).join(", ")}
                  </p>
                )}

                <div className="mt-3">
                  {installUrl !== undefined && installUrl !== "" ? (
                    <a
                      href={installUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-block rounded border border-teal-500/60 px-3 py-1 text-sm text-teal-300 hover:bg-teal-950/60"
                    >
                      Connect (buka situs resmi)
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        onConnect(harness.id);
                      }}
                      className="rounded border border-teal-500/60 px-3 py-1 text-sm text-teal-300 hover:bg-teal-950/60"
                    >
                      Connect (buka situs resmi)
                    </button>
                  )}
                  <p className="mt-1 text-xs text-slate-500">
                    Tombol ini hanya membuka halaman resmi harness di tab baru. Aplikasi tidak
                    pernah menjalankan installer pihak ketiga.
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
