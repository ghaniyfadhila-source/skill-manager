/**
 * Tipe domain Skill Manager v0.1.
 *
 * File ini adalah kontrak bersama ticket 02-11. Bentuk `StateFile` mengikuti
 * spec §9 persis; jangan menambah field state tanpa memperbarui spec.
 */

/** Versi skema `state.json` yang ditulis v0.1. */
export const STATE_SCHEMA_VERSION = 1 as const;

export type Scope = "global" | "project";

/** Format id Target untuk CLI/API, mis. `"claude-code/global"`. */
export type TargetId = `${string}/${Scope}`;

/** Pasangan (harness, scope); setiap Target memetakan ke tepat satu Store. */
export interface Target {
  readonly harnessId: string;
  readonly scope: Scope;
  /** Id Store kanonik, mis. `"~/.claude/skills"`. */
  readonly storeId: string;
}

/** Tingkat kemampuan harness (spec §5.2). */
export type HarnessCapability = "managed" | "detected";

/** Data tombol Connect; server tidak pernah menjalankan installer. */
export interface ConnectInfo {
  readonly installUrl: string;
}

/**
 * Harness yang dikenal aplikasi beserta hasil deteksi terakhir.
 * `capability: "detected"` = Detected-only: terlihat di UI, tidak bisa dipasangi.
 */
export interface Harness {
  readonly id: string;
  readonly name: string;
  readonly capability: HarnessCapability;
  readonly detected: boolean;
  /** Alasan deteksi yang bisa ditampilkan ke user (path ada, binary di PATH, dst.). */
  readonly detectionReasons: readonly string[];
  /** Store yang menjadi tujuan harness ini (id kanonik seperti pada Store.id). */
  readonly storeIds: readonly string[];
  readonly connect?: ConnectInfo;
}

/**
 * Direktori fisik tempat Installation berada. Satu Store bisa dipakai beberapa
 * harness (mis. `.agents/skills`); `exclusive` menandai isolasi penuh.
 */
export interface Store {
  /** Id kanonik dengan `~`, dipakai di state.json: `"~/.claude/skills"`. */
  readonly id: string;
  /** Path absolut hasil ekspansi `~` (diisi adapter/deteksi, bukan state). */
  readonly path: string;
  /** Id harness yang membaca Store ini. */
  readonly members: readonly string[];
  readonly exclusive: boolean;
}

/** Asal usul isi skill. */
export type SourceInfo =
  | {
      readonly type: "folder";
      /** Path folder sumber saat diimpor. */
      readonly path: string;
    }
  | {
      readonly type: "git";
      readonly url: string;
      readonly ref: string;
      /** Commit yang di-pin saat impor. */
      readonly commit: string;
    }
  | {
      readonly type: "zip";
      /** Path arsip zip sumber saat diimpor. */
      readonly path: string;
    };

export type SourceType = SourceInfo["type"];

/**
 * Satu skill kanonik di Library; juga entri `library[]` pada state.json.
 * `dirName` adalah nama folder fisik di `<dataRoot>/library`.
 */
export interface Skill {
  /** Id stabil, mis. `"sk_01H..."`. */
  readonly id: string;
  /** Nama logis skill (dari frontmatter SKILL.md). */
  readonly name: string;
  /** Nama folder di Library; v0.1 sama dengan `name` setelah sanitasi. */
  readonly dirName: string;
  /** `"sha256:<hex>"` dari contentHash Library. */
  readonly contentHash: string;
  readonly source: SourceInfo;
  /** Lisensi yang terdeteksi saat impor, bila ada. */
  readonly license?: string;
  /** Waktu impor, ISO 8601. */
  readonly importedAt: string;
}

/** Kumpulan skill kanonik; diserialisasi sebagai array `library` di state.json. */
export type Library = readonly Skill[];

/** Cara isi skill hadir di Store (ADR 0001: default copy). */
export type MaterializationMode = "copy" | "symlink";

/** Catatan bahwa sebuah skill dipasang pada sebuah Store (state.json §9). */
export interface Installation {
  readonly skillId: string;
  readonly storeId: string;
  readonly mode: MaterializationMode;
  /** `"sha256:<hex>"` isi Store saat dipasang. */
  readonly installedHash: string;
  /** Waktu pasang, ISO 8601. */
  readonly installedAt: string;
}

/** Status drift satu Installation terhadap Library (spec §10.5). */
export type DriftStatus = "clean" | "modified" | "missing" | "unmanaged";

/**
 * Catatan proyek untuk scope `project` (ditunda ke v0.2). v0.1 selalu menulis
 * array kosong; bentuk minimal ini sengaja tidak dipakai untuk logika apa pun.
 */
export interface ProjectRecord {
  /** Path absolut folder proyek. */
  readonly path: string;
}

export interface Settings {
  /**
   * Id harness yang dipilih ikut grup shared (mis. opencode yang melepas Store
   * eksklusifnya). Spec §9 hanya mendefinisikan field ini.
   */
  readonly sharedGroupMembers: readonly string[];
}

/** Isi `<dataRoot>/state.json`; disk tetap sumber kebenaran, state hanya indeks. */
export interface StateFile {
  readonly schemaVersion: typeof STATE_SCHEMA_VERSION;
  readonly library: Library;
  readonly installations: readonly Installation[];
  readonly projects: readonly ProjectRecord[];
  readonly settings: Settings;
}
