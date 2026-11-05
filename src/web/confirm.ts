import { type ApiError, isApiError } from "./api.js";

/**
 * Satu permintaan konfirmasi yang harus dilihat user sebelum aksi berjalan.
 *
 * AC-6: setiap aksi destruktif menyebut DAMPAKNYA. `details` berisi baris-baris
 * dampak (nama member, path, hash) dan `message` menjelaskan apa yang terjadi.
 */
export interface ConfirmPrompt {
  readonly kind: "shared" | "drift" | "destructive";
  readonly title: string;
  readonly message: string;
  readonly details: readonly string[];
  readonly confirmLabel: string;
}

export interface SharedImpact {
  readonly stores: readonly { readonly storeId: string; readonly members: readonly string[] }[];
  readonly targets: readonly string[];
}

export interface DriftImpact {
  readonly storeId?: string;
  readonly path?: string;
  readonly expectedHash?: string;
  readonly actualHash?: string;
}

export type ConfirmationAction = "install" | "uninstall";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

/**
 * Ambil daftar member terdampak dari galat 409 `shared_confirmation_required`.
 * Server mengirim `details.stores[].members` (kontrak §7 + `src/install/*`),
 * dan UI wajib menampilkannya sebelum mengirim ulang dengan `acknowledgeShared`.
 */
export function sharedImpactFromError(error: unknown): SharedImpact | null {
  if (!isApiError(error) || error.code !== "shared_confirmation_required") {
    return null;
  }
  return sharedImpactFromDetails(error.details);
}

export function sharedImpactFromDetails(details: unknown): SharedImpact | null {
  if (!isRecord(details) || !Array.isArray(details.stores)) {
    return null;
  }
  const stores: { storeId: string; members: string[] }[] = [];
  for (const entry of details.stores) {
    if (!isRecord(entry)) {
      continue;
    }
    const members = strings(entry.members);
    if (members.length === 0) {
      continue;
    }
    stores.push({ storeId: String(entry.storeId ?? "Store tanpa id"), members });
  }
  if (stores.length === 0) {
    return null;
  }
  return { stores, targets: strings(details.targets) };
}

export function driftImpactFromError(error: unknown): DriftImpact | null {
  if (!isApiError(error) || error.code !== "drift_detected" || !isRecord(error.details)) {
    return null;
  }
  const details = error.details;
  return {
    storeId: typeof details.storeId === "string" ? details.storeId : undefined,
    path: typeof details.path === "string" ? details.path : undefined,
    expectedHash: typeof details.expectedHash === "string" ? details.expectedHash : undefined,
    actualHash: typeof details.actualHash === "string" ? details.actualHash : undefined,
  };
}

export function sharedPrompt(impact: SharedImpact, action: ConfirmationAction): ConfirmPrompt {
  const verb = action === "install" ? "memasang" : "mencabut";
  const consequence =
    action === "install"
      ? "Semua member di bawah ini akan melihat skill tersebut."
      : "Salinan skill akan DIHAPUS untuk semua member di bawah ini sekaligus.";
  const members = impact.stores.map((store) => `${store.storeId}: ${store.members.join(", ")}`);
  return {
    kind: "shared",
    title: "Konfirmasi grup shared",
    message: `${verb[0]?.toUpperCase() ?? ""}${verb.slice(1)} ke grup shared akan memengaruhi member berikut. ${consequence}`,
    details: members,
    confirmLabel:
      action === "install" ? "Ya, pasang untuk semua member" : "Ya, cabut untuk semua member",
  };
}

export function driftPrompt(impact: DriftImpact, skillName: string): ConfirmPrompt {
  const details: string[] = [];
  if (impact.path !== undefined) {
    details.push(`Path: ${impact.path}`);
  }
  if (impact.storeId !== undefined) {
    details.push(`Store: ${impact.storeId}`);
  }
  if (impact.expectedHash !== undefined) {
    details.push(`Hash saat dipasang: ${impact.expectedHash}`);
  }
  if (impact.actualHash !== undefined) {
    details.push(`Hash isi sekarang: ${impact.actualHash}`);
  }
  return {
    kind: "drift",
    title: "Isi Store berubah sejak dipasang",
    message:
      `Isi "${skillName}" di Store sudah berbeda dari catatan pemasangan. ` +
      "Kalau kamu lanjutkan, salinan yang sudah diubah itu DIHAPUS dan tidak bisa dikembalikan. " +
      "Pilihan aman: batalkan, lalu pakai Sinkron untuk memulihkan isi dari Library.",
    details,
    confirmLabel: "Ya, hapus tetap",
  };
}

/**
 * Konfirmasi wajib SEBELUM mencabut — bukan hanya saat server membalas 409.
 * Mencabut menghapus salinan di Store; Library tetap utuh sehingga pemasangan
 * ulang tidak butuh jaringan.
 */
export function uninstallPrompt(
  skillName: string,
  targetId: string,
  storeId?: string,
): ConfirmPrompt {
  return {
    kind: "destructive",
    title: `Cabut ${skillName}?`,
    message:
      `Mencabut "${skillName}" dari ${targetId} akan menghapus salinan skill di Store. ` +
      "Library tidak diubah, jadi skill tetap ada dan bisa dipasang lagi kapan saja tanpa jaringan.",
    details: [
      `Target: ${targetId}`,
      storeId === undefined
        ? "Direktori skill di Store dihapus."
        : `Store: ${storeId} — direktori skill dihapus.`,
    ],
    confirmLabel: `Ya, cabut ${skillName}`,
  };
}

/** Jalan aman untuk aksi destruktif: user boleh menolak kapan saja. */
export type Ask = (prompt: ConfirmPrompt) => Promise<boolean>;

export interface ConfirmOptions {
  readonly acknowledgeShared: boolean;
  readonly force: boolean;
}

/**
 * Jalankan operasi yang butuh persetujuan, berputar sampai server menerima atau
 * user menolak.
 *
 * Alur (AC-6):
 * 1. kirim tanpa `acknowledgeShared`;
 * 2. bila server membalas 409 shared, tampilkan member terdampak lalu minta konfirmasi;
 * 3. user setuju -> kirim ulang dengan `acknowledgeShared: true`.
 *
 * Saat mencabut, 409 `drift_detected` ditangani dengan cara yang sama: tampilkan
 * kedua hash, minta konfirmasi, lalu kirim `force: true`.
 */
export async function confirmAndRun<T>(
  action: ConfirmationAction,
  operation: (options: ConfirmOptions) => Promise<T>,
  ask: Ask,
  /** Nama skill untuk judul dialog; pemanggil tahu, galat server tidak selalu. */
  skillName = "skill ini",
): Promise<T | null> {
  let options: ConfirmOptions = { acknowledgeShared: false, force: false };
  for (;;) {
    try {
      return await operation(options);
    } catch (error) {
      const shared = sharedImpactFromError(error);
      if (shared !== null && !options.acknowledgeShared) {
        if (!(await ask(sharedPrompt(shared, action)))) {
          return null;
        }
        options = { ...options, acknowledgeShared: true };
        continue;
      }

      const drift = action === "uninstall" ? driftImpactFromError(error) : null;
      if (drift !== null && !options.force) {
        if (!(await ask(driftPrompt(drift, skillName)))) {
          return null;
        }
        options = { ...options, force: true };
        continue;
      }

      throw error;
    }
  }
}

export function isConflict(error: unknown): error is ApiError {
  return isApiError(error) && error.status === 409;
}
