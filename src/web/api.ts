import type {
  CatalogItem,
  DepCommand,
  DepsRunResult,
  DoctorReport,
  HarnessCapability,
  HarnessInfo,
  InspectRequest,
  InspectResult,
  InstallationView,
  InstallRequest,
  SkillDetail,
  SkillSummary,
  SyncRequest,
  TargetResult,
  UninstallRequest,
} from "./types.js";

/** Bentuk minimal `fetch` yang dibutuhkan; bisa diganti di test tanpa jaringan. */
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiErrorInit {
  readonly code: string;
  readonly message: string;
  readonly status: number;
  readonly details?: unknown;
}

const STATUS_CODE: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
};

/**
 * Galat HTTP dari server. `code` stabil dan `details` dibawa utuh karena UI
 * butuh isinya untuk keputusan user (mis. daftar member grup shared, AC-6).
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = "ApiError";
    this.code = init.code;
    this.status = init.status;
    this.details = init.details;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function apiErrorFromBody(body: unknown, status: number): ApiError {
  const fallback = STATUS_CODE[status] ?? "internal_error";
  if (!isRecord(body) || !isRecord(body.error)) {
    return new ApiError({
      code: fallback,
      message: `Server membalas status ${status} tanpa body galat JSON.`,
      status,
    });
  }
  const { code, message, details } = body.error;
  return new ApiError({
    code: typeof code === "string" && code !== "" ? code : fallback,
    message: typeof message === "string" && message !== "" ? message : fallback,
    status,
    details,
  });
}

interface RequestOptions {
  readonly method?: string;
  readonly body?: unknown;
}

async function send<T>(fetcher: Fetcher, path: string, options: RequestOptions = {}): Promise<T> {
  const init: RequestInit = {
    method: options.method ?? "GET",
    // Cookie sm_session wajib ikut; server menolak request tanpa sesi valid.
    credentials: "same-origin",
  };
  if (options.body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetcher(path, init);
  } catch (cause) {
    throw new ApiError({
      code: "network_error",
      message:
        "Tidak bisa menghubungi server lokal. Pastikan proses `skill-manager serve` masih jalan.",
      status: 0,
      details: { cause: cause instanceof Error ? cause.message : String(cause) },
    });
  }

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    throw apiErrorFromBody(body, response.status);
  }

  try {
    return (await response.json()) as T;
  } catch {
    return undefined as T;
  }
}

function listAt<T>(body: unknown, key: string): T[] {
  if (isRecord(body)) {
    const value = body[key];
    if (Array.isArray(value)) {
      return value as T[];
    }
  }
  return [];
}

function recordAt<T>(body: unknown, key: string): T {
  if (isRecord(body)) {
    const value = body[key];
    if (isRecord(value)) {
      return value as T;
    }
  }
  return {} as T;
}

function normalizeCapability(value: unknown): HarnessCapability {
  return value === "managed" ? "managed" : "detected";
}

function normalizeCatalogItem(value: unknown): CatalogItem {
  const raw = isRecord(value) ? value : {};
  return {
    id: String(raw.id ?? raw.name ?? ""),
    name: String(raw.name ?? ""),
    description: String(raw.description ?? ""),
    owner: String(raw.owner ?? ""),
    repo: String(raw.repo ?? ""),
    subdir: String(raw.subdir ?? ""),
    url: String(raw.url ?? ""),
    stars: typeof raw.stars === "number" ? raw.stars : undefined,
    installed: raw.installed === true,
  };
}

function normalizeHarness(value: unknown): HarnessInfo {
  const raw = isRecord(value) ? value : {};
  const connect = isRecord(raw.connect) ? raw.connect : undefined;
  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? raw.id ?? "Harness tanpa nama"),
    capability: normalizeCapability(raw.capability),
    detected: raw.detected === true,
    detectionReasons: Array.isArray(raw.detectionReasons)
      ? raw.detectionReasons.map((reason) => String(reason))
      : [],
    storeIds: Array.isArray(raw.storeIds) ? raw.storeIds.map((id) => String(id)) : [],
    targets: Array.isArray(raw.targets)
      ? raw.targets.filter(isRecord).map((target) => ({
          id: String(target.id ?? ""),
          harnessId: typeof target.harnessId === "string" ? target.harnessId : undefined,
          scope: typeof target.scope === "string" ? target.scope : undefined,
          storeId: typeof target.storeId === "string" ? target.storeId : undefined,
          label: typeof target.label === "string" ? target.label : undefined,
        }))
      : [],
    connect: connect === undefined ? undefined : { installUrl: String(connect.installUrl ?? "") },
  };
}

function normalizeDoctor(body: unknown): DoctorReport {
  const entries = (value: unknown): DoctorReport["missing"] =>
    Array.isArray(value) ? (value.filter(isRecord) as DoctorReport["missing"]) : [];
  const raw = isRecord(body) ? body : {};
  return {
    missing: entries(raw.missing),
    unmanaged: entries(raw.unmanaged),
    stale: entries(raw.stale),
    tempDirs: Array.isArray(raw.tempDirs) ? raw.tempDirs.map((dir) => String(dir)) : [],
  };
}

/** Klien HTTP tipis untuk seluruh endpoint kontrak §7. */
export interface Api {
  health(): Promise<{ ok: boolean; version?: string }>;
  harnesses(): Promise<HarnessInfo[]>;
  recheckHarnesses(): Promise<HarnessInfo[]>;
  skills(): Promise<SkillSummary[]>;
  skill(name: string): Promise<SkillDetail>;
  inspect(input: InspectRequest): Promise<InspectResult>;
  importSkill(
    input: { stagingId: string } | { type: "folder"; path: string },
  ): Promise<SkillSummary>;
  installations(): Promise<InstallationView[]>;
  install(input: InstallRequest): Promise<TargetResult[]>;
  uninstall(input: UninstallRequest): Promise<TargetResult[]>;
  catalog(): Promise<CatalogItem[]>;
  sync(input: SyncRequest): Promise<unknown>;
  doctor(): Promise<DoctorReport>;
  cleanTemp(): Promise<string[]>;
  depsPlan(input: { skill: string }): Promise<DepCommand[]>;
  depsRun(input: { skill: string; allowScripts?: boolean }): Promise<DepsRunResult>;
  connect(harnessId: string): Promise<string>;
}

export function createApi(fetcher: Fetcher = (input, init) => globalThis.fetch(input, init)): Api {
  return {
    async health() {
      return send<{ ok: boolean; version?: string }>(fetcher, "/api/health");
    },
    async harnesses() {
      return listAt<unknown>(await send(fetcher, "/api/harnesses"), "harnesses").map(
        normalizeHarness,
      );
    },
    async recheckHarnesses() {
      return listAt<unknown>(
        await send(fetcher, "/api/harnesses/recheck", { method: "POST" }),
        "harnesses",
      ).map(normalizeHarness);
    },
    async skills() {
      return listAt<SkillSummary>(await send(fetcher, "/api/skills"), "skills");
    },
    async skill(name) {
      return recordAt<SkillDetail>(
        await send(fetcher, `/api/skills/${encodeURIComponent(name)}`),
        "skill",
      );
    },
    async inspect(input) {
      return await send<InspectResult>(fetcher, "/api/skills/inspect", {
        method: "POST",
        body: input,
      });
    },
    async importSkill(input) {
      return recordAt<SkillSummary>(
        await send(fetcher, "/api/skills/import", { method: "POST", body: input }),
        "skill",
      );
    },
    async installations() {
      return listAt<InstallationView>(await send(fetcher, "/api/installations"), "installations");
    },
    async install(input) {
      return listAt<TargetResult>(
        await send(fetcher, "/api/installations", { method: "POST", body: input }),
        "results",
      );
    },
    async uninstall(input) {
      return listAt<TargetResult>(
        await send(fetcher, "/api/installations", { method: "DELETE", body: input }),
        "results",
      );
    },
    async catalog() {
      return listAt<CatalogItem>(await send(fetcher, "/api/catalog"), "items").map(
        normalizeCatalogItem,
      );
    },
    async sync(input) {
      return await send<unknown>(fetcher, "/api/sync", { method: "POST", body: input });
    },
    async doctor() {
      return normalizeDoctor(await send<unknown>(fetcher, "/api/doctor"));
    },
    async cleanTemp() {
      const body = await send<unknown>(fetcher, "/api/doctor/clean-temp", { method: "POST" });
      return listAt<string>(body, "removed");
    },
    async depsPlan(input) {
      return listAt<DepCommand>(
        await send(fetcher, "/api/deps/plan", { method: "POST", body: input }),
        "commands",
      );
    },
    async depsRun(input) {
      return await send<DepsRunResult>(fetcher, "/api/deps/run", { method: "POST", body: input });
    },
    async connect(harnessId) {
      const body = await send<unknown>(fetcher, `/api/connect/${encodeURIComponent(harnessId)}`);
      return isRecord(body) ? String(body.url ?? "") : "";
    },
  };
}
