import { type ReactNode, useEffect, useRef } from "react";
import type { ConfirmPrompt } from "./confirm.js";

/** Tombol Escape menutup dialog; dipisah supaya bisa diuji tanpa DOM. */
export function handleDialogKey(
  event: { key: string; preventDefault: () => void },
  onClose: () => void,
): boolean {
  if (event.key !== "Escape") {
    return false;
  }
  event.preventDefault();
  onClose();
  return true;
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-6 text-slate-300">
      <p className="font-medium text-slate-100">{title}</p>
      {children !== undefined && <div className="mt-2 text-sm">{children}</div>}
      {action !== undefined && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorBanner({
  title,
  message,
  code,
  onRetry,
}: {
  title: string;
  message: string;
  code?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-rose-500/60 bg-rose-950/50 p-4 text-rose-100"
    >
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm">{message}</p>
        {code !== undefined && <p className="mt-1 font-mono text-xs text-rose-300">kode: {code}</p>}
      </div>
      {onRetry !== undefined && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded border border-rose-300/60 px-3 py-1 text-sm hover:bg-rose-900/60"
        >
          Coba lagi
        </button>
      )}
    </div>
  );
}

export function Chip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "warn";
}) {
  const toneClass =
    tone === "ok"
      ? "border-emerald-500/60 bg-emerald-950/60 text-emerald-200"
      : tone === "warn"
        ? "border-amber-500/60 bg-amber-950/60 text-amber-200"
        : "border-slate-600 bg-slate-800 text-slate-200";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${toneClass}`}
    >
      {children}
    </span>
  );
}

/** Ikon tekstual supaya status tidak dibedakan hanya dengan warna (WCAG 1.4.1). */
export function StatusMark({ problem }: { problem: boolean }) {
  return <span aria-hidden="true">{problem ? "!" : "\u2713"}</span>;
}

export function ConfirmDialog({
  prompt,
  busy = false,
  onConfirm,
  onCancel,
}: {
  prompt: ConfirmPrompt;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = "confirm-dialog-title";
  const descriptionId = "confirm-dialog-description";

  // Fokus pindah ke pilihan aman, lalu kembali ke elemen sebelumnya saat ditutup.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => {
      previous?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={(event) => {
          handleDialogKey(event, onCancel);
        }}
        className="w-full max-w-lg rounded-xl border border-amber-500/60 bg-slate-900 p-6 shadow-xl"
      >
        <h2 id={titleId} className="text-lg font-semibold text-amber-200">
          {prompt.title}
        </h2>
        <p id={descriptionId} className="mt-2 text-sm text-slate-200">
          {prompt.message}
        </p>
        {prompt.details.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 rounded border border-amber-500/30 bg-amber-950/30 p-3 pl-7 text-sm text-amber-100">
            {prompt.details.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            Batalkan
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-60"
          >
            {prompt.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <p role="status" className="text-sm text-slate-400">
      {label}
    </p>
  );
}
