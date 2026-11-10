import type { Context } from "hono";
import type { ZodType } from "zod";
import { SkillManagerError } from "../../core/errors.js";
import type { ProcessRunner } from "../../fs/process.js";
import type { FileSystem, FsError, FsResult } from "../../fs/types.js";

/**
 * Dependensi yang disuntikkan ke route API. Test memakai MemoryFileSystem +
 * FakeProcessRunner dengan dataRoot/home sementara; produksi memakai
 * implementasi Node. Tidak ada I/O saat modul dimuat.
 */
export interface ServerDeps {
  readonly fs: FileSystem;
  readonly runner: ProcessRunner;
  readonly dataRoot: string;
  readonly home: string;
  /**
   * Fetch untuk metadata katalog (live). Opsional supaya route lain dan test
   * lama tidak berubah; katalog jatuh ke `globalThis.fetch` bila tidak diisi.
   */
  readonly fetch?: (url: string) => Promise<Response>;
}

/** Bentuk badan galat yang dijanjikan kontrak §7 untuk setiap respons gagal. */
export interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
  };
}

function describeIssues(error: {
  issues: readonly { path: PropertyKey[]; message: string }[];
}): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

/** Baca body JSON lalu validasi dengan zod; galat apa pun menjadi bad_request. */
export async function readJson<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    throw new SkillManagerError({
      code: "bad_request",
      message: "Body request harus JSON yang valid.",
    });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new SkillManagerError({
      code: "bad_request",
      message: "Body request tidak sesuai bentuk yang diharapkan.",
      details: { issues: describeIssues(parsed.error) },
    });
  }
  return parsed.data;
}

/** Bungkus galat filesystem menjadi galat domain dengan kode yang sama. */
export function fsFailure(error: FsError): SkillManagerError {
  return new SkillManagerError({
    code: error.code,
    message: error.message,
    details: { path: error.path },
  });
}

/** Nilai sukses, atau lempar galat domain dari kegagalan filesystem. */
export function unwrap<T>(result: FsResult<T>): T {
  if (!result.ok) {
    throw fsFailure(result.error);
  }
  return result.value;
}
/** Kode galat domain selalu snake_case huruf kecil; errno Node ("ENOENT") bukan. */
const DOMAIN_CODE_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

/**
 * Hono hanya meneruskan `Error` ke app.onError, sedangkan sebagian modul domain
 * melempar FsError apa adanya. Ubah bentuk itu menjadi SkillManagerError di
 * batas route agar klien tetap menerima { error: { code, message, details? } }.
 */
export function asDomainError(error: unknown): unknown {
  if (error instanceof SkillManagerError) {
    return error;
  }
  if (typeof error === "object" && error !== null) {
    const candidate = error as { code?: unknown; message?: unknown; path?: unknown };
    if (
      typeof candidate.code === "string" &&
      DOMAIN_CODE_PATTERN.test(candidate.code) &&
      typeof candidate.message === "string"
    ) {
      return new SkillManagerError({
        code: candidate.code,
        message: candidate.message,
        ...(typeof candidate.path === "string" ? { details: { path: candidate.path } } : {}),
      });
    }
  }
  return error;
}
