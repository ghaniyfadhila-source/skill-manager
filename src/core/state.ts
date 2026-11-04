import { z } from "zod";
import { type FileSystem, type FsResult, fsOk } from "../fs/types.js";
import { statePath } from "./paths.js";
import { STATE_SCHEMA_VERSION, type StateFile } from "./types.js";

export const STATE_FILE_NAME = "state.json";

const contentHashSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/, "harus berformat sha256:<64 hex lowercase>");

const sourceInfoSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("folder"), path: z.string().min(1) }),
  z.object({
    type: z.literal("git"),
    url: z.string().min(1),
    ref: z.string().min(1),
    commit: z.string().min(1),
  }),
  z.object({ type: z.literal("zip"), path: z.string().min(1) }),
]);

const skillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  dirName: z.string().min(1),
  contentHash: contentHashSchema,
  source: sourceInfoSchema,
  license: z.string().optional(),
  importedAt: z.string().min(1),
});

const installationSchema = z.object({
  skillId: z.string().min(1),
  storeId: z.string().min(1),
  mode: z.enum(["copy", "symlink"]),
  installedHash: contentHashSchema,
  installedAt: z.string().min(1),
});

const projectSchema = z.object({
  path: z.string().min(1),
});

/** Schema state.json persis spec §9. Field tak dikenal dibuang oleh zod. */
export const stateFileSchema = z.object({
  schemaVersion: z.literal(STATE_SCHEMA_VERSION),
  library: z.array(skillSchema),
  installations: z.array(installationSchema),
  projects: z.array(projectSchema),
  settings: z.object({
    sharedGroupMembers: z.array(z.string().min(1)),
  }),
});

export type StateLoadStatus = "loaded" | "missing" | "recovered" | "unsupported_version";

export interface StateLoadResult {
  readonly state: StateFile;
  /** `recovered` berarti state korup/tidak terbaca dan diganti state kosong. */
  readonly status: StateLoadStatus;
  /** Alasan bila status `recovered`; tidak diisi untuk loaded/missing. */
  readonly reason?: string;
}

/** State kosong yang selalu baru (array tidak dibagi antar pemanggilan). */
export function emptyState(): StateFile {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    library: [],
    installations: [],
    projects: [],
    settings: { sharedGroupMembers: [] },
  };
}

function recovered(reason: string): StateLoadResult {
  return { state: emptyState(), status: "recovered", reason };
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const location = issue.path.length > 0 ? issue.path.join(".") : "(akar)";
      return `${location}: ${issue.message}`;
    })
    .join("; ");
}

/**
 * Baca state.json. Tidak pernah melempar dan tidak pernah crash karena isi
 * korup: state kosong dikembalikan dengan `status: "recovered"` + `reason`.
 * Disk tetap sumber kebenaran; state hanya indeks (spec §9).
 */
export async function loadState(fs: FileSystem, dataRoot: string): Promise<StateLoadResult> {
  const filePath = statePath(dataRoot);
  const text = await fs.readText(filePath);
  if (!text.ok) {
    if (text.error.code === "not_found") {
      return { state: emptyState(), status: "missing" };
    }
    return recovered(
      `${STATE_FILE_NAME} tidak bisa dibaca (${text.error.code}): ${text.error.message}`,
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text.value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return recovered(`${STATE_FILE_NAME} bukan JSON valid: ${message}`);
  }

  // Versi skema yang lebih baru tidak boleh diperlakukan sebagai "korup":
  // pengguna perlu tahu bahwa ini state dari versi aplikasi yang lebih baru.
  // Migrasi belum ada di v0.1, jadi state lama tidak dibaca, tetapi file-nya
  // tidak hilang — saveState mengarantinanya sebelum menimpa.
  const version = (parsedJson as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (typeof version === "number" && version > STATE_SCHEMA_VERSION) {
    return {
      state: emptyState(),
      status: "unsupported_version",
      reason: `${STATE_FILE_NAME} memakai schemaVersion ${version}, sedangkan aplikasi ini hanya mendukung ${STATE_SCHEMA_VERSION}.`,
    };
  }

  const parsed = stateFileSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return recovered(`${STATE_FILE_NAME} tidak sesuai schema: ${formatIssues(parsed.error)}`);
  }
  return { state: parsed.data, status: "loaded" };
}

/** Nama file karantina untuk state.json yang tidak bisa diparse. */
export const CORRUPT_STATE_FILE_NAME = "state.json.corrupt";

/**
 * Pindahkan state.json yang korup ke `state.json.corrupt` sebelum ditimpa.
 *
 * Tanpa ini, state yang korup akan hilang permanen pada penyimpanan berikutnya.
 * Hanya dipanggil dari `saveState`, tidak pernah saat startup (AC-10).
 */
async function quarantineCorruptState(fs: FileSystem, targetPath: string): Promise<void> {
  const existing = await fs.readText(targetPath);
  if (!existing.ok) {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(existing.value);
  } catch {
    parsed = undefined;
  }
  if (parsed !== undefined && stateFileSchema.safeParse(parsed).success) {
    return;
  }

  const corruptPath = `${targetPath}.corrupt`;
  await fs.remove(corruptPath);
  await fs.rename(targetPath, corruptPath);
}

/**
 * Tulis state.json secara atomik: tulis `state.json.tmp`, lalu rename
 * (spec §9). Bila gagal, file sementara dibersihkan dan state lama dibiarkan.
 *
 * State lama yang korup dikarantina ke `state.json.corrupt` lebih dulu agar
 * tidak hilang tanpa jejak.
 */
export async function saveState(
  fs: FileSystem,
  dataRoot: string,
  state: StateFile,
): Promise<FsResult<void>> {
  const targetPath = statePath(dataRoot);
  const tempPath = `${targetPath}.tmp`;

  const directory = await fs.mkdir(dataRoot, { recursive: true });
  if (!directory.ok) {
    return directory;
  }

  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  const written = await fs.write(tempPath, serialized);
  if (!written.ok) {
    await fs.remove(tempPath);
    return written;
  }

  await quarantineCorruptState(fs, targetPath);

  const renamed = await fs.rename(tempPath, targetPath);
  if (!renamed.ok) {
    await fs.remove(tempPath);
    return renamed;
  }
  return fsOk(undefined);
}
