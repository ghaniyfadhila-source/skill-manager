/**
 * Impor skill dari repositori git (spec §10.2, AC-3).
 *
 * Alur: validasi URL -> clone dangkal ke direktori sementara -> checkout ref
 * (bila perlu) -> resolusi commit -> temukan folder skill -> serahkan ke
 * importFromDirectory dengan provenance git -> bersihkan direktori sementara.
 *
 * Kebijakan URL: hanya https:// dan http://. Skema lain ditolak — git+ssh,
 * ssh, dan file: membutuhkan agen/kunci SSH atau membaca path lokal, dan
 * aplikasi lokal ini tidak boleh menggantung menunggu passphrase atau menyentuh
 * filesystem di luar data root. Repositori privat bisa memakai HTTPS + token.
 *
 * Ref yang berbentuk 7-64 karakter heksadesimal selalu diperlakukan sebagai
 * commit SHA, bukan nama branch/tag.
 *
 * Isi repositori TIDAK DIPERCAYA: tidak ada kode skill yang dieksekusi, dan
 * git dijalankan tanpa shell lewat ProcessRunner.
 */
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { SkillManagerError } from "../core/errors.js";
import type { SourceInfo } from "../core/types.js";
import type { ProcessResult, ProcessRunner } from "../fs/process.js";
import type { FileSystem } from "../fs/types.js";
import { type ImportResult, importFromDirectory } from "./import-folder.js";
import { findSkillDirectory, readSkillName } from "./skill-source.js";

/** Binary git; tidak pernah lewat shell. */
export const GIT_BINARY = "git";

/** Batas waktu clone (jaringan bisa lambat); perintah git lain lebih singkat. */
export const GIT_CLONE_TIMEOUT_MS = 120_000;

/** Batas waktu checkout, fetch, dan rev-parse. */
export const GIT_COMMAND_TIMEOUT_MS = 60_000;

/** Kode galat stabil modul impor git. */
export type GitImportErrorCode =
  | "invalid_git_url"
  | "invalid_git_ref"
  | "git_not_available"
  | "git_clone_failed"
  | "git_ref_not_found"
  | "git_timeout"
  | "temp_dir_failed";

export interface ImportGitOptions {
  /** URL repositori, hanya skema https/http. */
  readonly url: string;
  /** Branch, tag, atau commit SHA. Default: HEAD cabang bawaan. */
  readonly ref?: string;
  /** Induk direktori sementara; default os.tmpdir(). */
  readonly tempRoot?: string;
  /** Nama satu segmen direktori sementara; disuntikkan test agar deterministik. */
  readonly newTempDirName?: () => string;
  /** Generator id skill; disuntikkan test agar deterministik. */
  readonly newSkillId?: () => string;
  /** Sumber waktu impor; disuntikkan test agar deterministik. */
  readonly now?: () => string;
}

const ALLOWED_PROTOCOLS = new Set(["https:", "http:"]);
const SHA_PATTERN = /^[0-9a-f]{7,64}$/i;
const COMMIT_PATTERN = /^[0-9a-f]{7,64}$/;
const STDERR_EXCERPT_LENGTH = 400;

function gitError(code: GitImportErrorCode, message: string, details?: unknown): SkillManagerError {
  return new SkillManagerError({ code, message, ...(details === undefined ? {} : { details }) });
}

/** Validasi URL dan kembalikan bentuknya untuk dipakai git. */
export function validateGitUrl(raw: string): string {
  const candidate = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw gitError(
      "invalid_git_url",
      `URL git tidak valid: "${raw}". Gunakan URL https:// atau http://.`,
    );
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol) || parsed.hostname === "") {
    throw gitError(
      "invalid_git_url",
      `Skema URL git "${parsed.protocol}" tidak didukung. v0.1 hanya menerima https:// dan http:// (tanpa SSH/file).`,
    );
  }
  return candidate;
}

function resolveRef(raw: string | undefined): string {
  const ref = raw?.trim();
  if (ref === undefined || ref === "") {
    return "HEAD";
  }
  // Cegah argumen git yang terbaca sebagai opsi (mis. --upload-pack=...).
  if (ref.startsWith("-") || /\s/.test(ref)) {
    throw gitError("invalid_git_ref", `Ref git tidak valid: "${ref}".`);
  }
  return ref;
}

function tempDirectory(options: ImportGitOptions): string {
  const name = (options.newTempDirName ?? (() => `skill-manager-git-${randomUUID()}`))();
  // Satu segmen saja, dan bukan "..": finally di bawah menghapus rekursif, jadi
  // nama yang salah bisa menghapus direktori di luar induk sementara.
  if (name === "" || name === "." || name === ".." || /[\\/:]/.test(name)) {
    throw gitError(
      "temp_dir_failed",
      `Nama direktori sementara tidak aman: "${name}". Impor dibatalkan.`,
    );
  }
  return path.join(options.tempRoot ?? os.tmpdir(), name);
}

function stderrExcerpt(result: ProcessResult): string {
  const text = result.stderr.trim() || result.stdout.trim();
  return text === "" ? "(tanpa keluaran)" : text.slice(0, STDERR_EXCERPT_LENGTH);
}

/** Jalankan git; kegagalan spawn/timeout dipetakan ke kode stabil. */
async function runGit(
  runner: ProcessRunner,
  args: readonly string[],
  cwd: string | undefined,
  timeoutMs: number,
): Promise<ProcessResult> {
  const result = await runner.run(
    GIT_BINARY,
    args,
    cwd === undefined ? { timeoutMs } : { cwd, timeoutMs },
  );
  if (!result.ok) {
    if (result.error.code === "process_not_found") {
      throw gitError(
        "git_not_available",
        "Git tidak ditemukan di PATH. Pasang Git lalu ulangi impor.",
        result.error,
      );
    }
    throw gitError(
      "git_clone_failed",
      `Gagal menjalankan git: ${result.error.message}`,
      result.error,
    );
  }
  return result.value;
}

function cloneArgs(url: string, ref: string, destination: string): string[] {
  const base = ["clone", "--depth", "1"];
  if (ref !== "HEAD" && !SHA_PATTERN.test(ref)) {
    base.push("--branch", ref);
  }
  base.push(url, destination);
  return base;
}

/**
 * Checkout commit SHA pada clone dangkal. Bila commit tidak ada di clone (umum
 * untuk SHA yang bukan ujung cabang), ambil commit itu langsung dari origin
 * dengan fetch --depth 1, lalu checkout ulang.
 */
async function checkoutCommit(runner: ProcessRunner, tempDir: string, sha: string): Promise<void> {
  const direct = await runGit(runner, ["checkout", sha], tempDir, GIT_COMMAND_TIMEOUT_MS);
  if (direct.code === 0) {
    return;
  }

  const fetched = await runGit(
    runner,
    ["fetch", "--depth", "1", "origin", sha],
    tempDir,
    GIT_COMMAND_TIMEOUT_MS,
  );
  if (fetched.code !== 0) {
    throw gitError(
      "git_ref_not_found",
      `Commit "${sha}" tidak ditemukan di repositori. Periksa ref lalu ulangi impor.`,
    );
  }

  // FETCH_HEAD menunjuk commit yang baru diambil, jadi tidak bergantung pada
  // objek yang bisa dijangkau dengan namanya di clone dangkal.
  const retried = await runGit(runner, ["checkout", "FETCH_HEAD"], tempDir, GIT_COMMAND_TIMEOUT_MS);
  if (retried.code !== 0) {
    throw gitError("git_ref_not_found", `Commit "${sha}" tidak bisa di-checkout.`);
  }
}

/** Hasil clone: URL/ref/commit yang benar-benar dipakai. */
export interface ClonedGitSource {
  readonly url: string;
  readonly ref: string;
  readonly commit: string;
}

/**
 * Clone dangkal ke `destination` tanpa mengimpor apa pun.
 *
 * Dipisahkan dari `importGitSkill` agar pratinjau sumber dari jaringan bisa
 * berhenti di sini (spec §13: pohon file dan penanda risiko ditampilkan sebelum
 * konfirmasi). Pemanggil bertanggung jawab membersihkan `destination`.
 */
export async function cloneGitTo(
  runner: ProcessRunner,
  options: Pick<ImportGitOptions, "url" | "ref">,
  destination: string,
): Promise<ClonedGitSource> {
  const url = validateGitUrl(options.url);
  const ref = resolveRef(options.ref);

  const clone = await runGit(
    runner,
    cloneArgs(url, ref, destination),
    undefined,
    GIT_CLONE_TIMEOUT_MS,
  );
  if (clone.timedOut) {
    throw gitError(
      "git_timeout",
      `git clone melewati batas waktu ${GIT_CLONE_TIMEOUT_MS} ms. Periksa jaringan lalu ulangi.`,
    );
  }
  if (clone.code !== 0) {
    throw gitError(
      "git_clone_failed",
      `git clone gagal (exit ${clone.code ?? "null"}): ${stderrExcerpt(clone)}.`,
    );
  }

  if (ref !== "HEAD" && SHA_PATTERN.test(ref)) {
    await checkoutCommit(runner, destination, ref);
  }

  const resolved = await runGit(runner, ["rev-parse", "HEAD"], destination, GIT_COMMAND_TIMEOUT_MS);
  const commit = resolved.stdout.trim();
  if (resolved.code !== 0 || !COMMIT_PATTERN.test(commit)) {
    throw gitError(
      "git_clone_failed",
      `Commit HEAD tidak bisa dibaca dari hasil clone: ${stderrExcerpt(resolved)}.`,
    );
  }

  return { url, ref, commit };
}

/**
 * Impor skill dari URL git ke Library. Direktori sementara selalu dibersihkan,
 * baik impor berhasil maupun gagal (sisa bila proses mati dibersihkan doctor).
 */
export async function importGitSkill(
  fs: FileSystem,
  dataRoot: string,
  runner: ProcessRunner,
  options: ImportGitOptions,
): Promise<ImportResult> {
  const tempDir = tempDirectory(options);

  try {
    const cloned = await cloneGitTo(runner, options, tempDir);
    const skillDir = await findSkillDirectory(fs, tempDir);
    const name = await readSkillName(fs, skillDir);
    const provenance: SourceInfo = {
      type: "git",
      url: cloned.url,
      ref: cloned.ref,
      commit: cloned.commit,
    };

    return await importFromDirectory(fs, dataRoot, {
      sourceDir: skillDir,
      provenance,
      name,
      ...(options.newSkillId === undefined ? {} : { newSkillId: options.newSkillId }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  } finally {
    // Hapus selalu; kegagalan bersih-bersih tidak menutupi galat utama dan
    // sisa direktori akan dilaporkan doctor (spec §14).
    await fs.remove(tempDir, { recursive: true });
  }
}
