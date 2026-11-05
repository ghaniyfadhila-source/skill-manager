/**
 * Bentuk JSON yang dipakai UI, disalin manual dari kontrak §7.
 *
 * UI sengaja TIDAK mengimpor tipe dari `src/core` atau `src/server`: satu-satunya
 * jalur komunikasi adalah HTTP, dan field yang tidak dikirim server boleh hilang.
 * Semua field non-esensial bertanda opsional supaya UI tidak pernah pecah karena
 * server belum lengkap.
 */

export type DriftStatus = "clean" | "modified" | "missing" | "unmanaged";

export type HarnessCapability = "managed" | "detected";

/** Provenance skill saat diimpor (mirror `SourceInfo` di core). */
export interface SourceInfo {
  readonly type: string;
  readonly path?: string;
  readonly url?: string;
  readonly ref?: string;
  readonly commit?: string;
}

export interface SkillSummary {
  readonly id: string;
  readonly name: string;
  readonly dirName?: string;
  readonly contentHash?: string;
  readonly source?: SourceInfo;
  readonly license?: string;
  readonly importedAt?: string;
}

export interface SkillFile {
  readonly path: string;
  readonly bytes?: number;
  /** Penanda risiko hasil inspeksi: `scripts`, `binary`, `symlink`, dst. */
  readonly risk?: string | null;
}

export interface DepCommand {
  readonly kind?: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly reason?: string;
  readonly dependencies?: readonly string[];
}

export interface SkillDetail extends SkillSummary {
  readonly files?: readonly SkillFile[];
  /** Dipakai untuk daftar dependensi di halaman detail (AC-9). */
  readonly dependencies?: readonly DepCommand[];
}

export interface HarnessTarget {
  readonly id: string;
  readonly harnessId?: string;
  readonly scope?: string;
  readonly storeId?: string;
  readonly label?: string;
}

export interface HarnessInfo {
  readonly id: string;
  readonly name: string;
  readonly capability: HarnessCapability;
  readonly detected: boolean;
  /** Alasan deteksi yang ditampilkan apa adanya ke user (AC-2). */
  readonly detectionReasons?: readonly string[];
  readonly storeIds?: readonly string[];
  /** Target yang bisa dipasangi; bila server belum mengirim, UI menurunkan `<id>/global`. */
  readonly targets?: readonly HarnessTarget[];
  readonly connect?: { readonly installUrl?: string };
}

export interface InstallationView {
  readonly skillId?: string;
  readonly skillName?: string;
  readonly targetId: string;
  readonly storeId?: string;
  readonly mode?: string;
  readonly installedHash?: string;
  readonly installedAt?: string;
  readonly drift?: DriftStatus;
}

export interface DriftEntry {
  readonly status?: DriftStatus;
  readonly storeId?: string;
  readonly path?: string;
  readonly skillId?: string;
  readonly skillName?: string;
  readonly installedHash?: string;
  readonly storeHash?: string;
  readonly behindLibrary?: boolean;
  readonly error?: { readonly code?: string; readonly message?: string };
}

export interface DoctorReport {
  readonly missing: readonly DriftEntry[];
  readonly unmanaged: readonly DriftEntry[];
  readonly tempDirs: readonly string[];
  readonly stale: readonly DriftEntry[];
}

export interface TargetResult {
  readonly targetId: string;
  readonly ok: boolean;
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
    readonly details?: unknown;
  };
}

export interface InspectRequest {
  readonly type: "folder" | "git" | "zip";
  readonly path?: string;
  readonly url?: string;
  readonly ref?: string;
}

/** Penanda risiko pratinjau (spec §13); bentuknya ditetapkan kontrak §7. */
export interface InspectRisk {
  readonly scripts?: boolean;
  readonly binary?: boolean;
  readonly escapingSymlink?: boolean;
  readonly messages?: readonly string[];
}

export interface InspectResult {
  readonly stagingId?: string;
  readonly files?: readonly SkillFile[];
  readonly risky?: InspectRisk;
  readonly totalBytes?: number;
  readonly license?: string;
  readonly suggestedName?: string;
  readonly provenance?: SourceInfo;
}

export interface InstallRequest {
  readonly skill: string;
  readonly targets: readonly string[];
  readonly acknowledgeShared?: boolean;
}

export interface UninstallRequest {
  readonly skill: string;
  readonly targets: readonly string[];
  readonly force?: boolean;
  readonly acknowledgeShared?: boolean;
}

export interface SyncRequest {
  readonly skill: string;
  readonly action: "restore" | "adopt";
}

export interface DepsRunResult {
  readonly ok?: boolean;
  readonly output?: string;
}
