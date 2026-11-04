import { describe, expect, it } from "vitest";
import { ApiError, createApi, type Fetcher } from "./api.js";

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

interface Call {
  readonly path: string;
  readonly init: RequestInit | undefined;
}

/** Merekam setiap panggilan fetch agar kontrak HTTP bisa diperiksa tanpa jaringan. */
function recorder(makeResponse: () => Promise<Response>): { fetcher: Fetcher; calls: Call[] } {
  const calls: Call[] = [];
  const fetcher: Fetcher = (path, init) => {
    calls.push({ path, init });
    return makeResponse();
  };
  return { fetcher, calls };
}

function bodyOf(call: Call | undefined): unknown {
  return JSON.parse(String(call?.init?.body)) as unknown;
}

describe("createApi — pemetaan galat", () => {
  it("memetakan { error: { code, message, details } } ke ApiError", async () => {
    const details = {
      stores: [{ storeId: "~/.agents/skills", members: ["codex", "gemini"] }],
      targets: ["shared/global"],
    };
    const { fetcher } = recorder(() =>
      jsonResponse(
        { error: { code: "shared_confirmation_required", message: "Setujui dulu.", details } },
        409,
      ),
    );

    const error = await createApi(fetcher)
      .install({ skill: "alpha", targets: ["shared/global"] })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: "shared_confirmation_required",
      message: "Setujui dulu.",
      details,
      status: 409,
    });
  });

  it("memakai kode dari status bila body galat bukan JSON", async () => {
    const { fetcher } = recorder(() => Promise.resolve(new Response("boom", { status: 500 })));

    const error = await createApi(fetcher)
      .skills()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "internal_error", status: 500 });
  });

  it("memetakan galat jaringan tanpa melempar TypeError mentah", async () => {
    const { fetcher } = recorder(() => Promise.reject(new TypeError("fetch failed")));

    const error = await createApi(fetcher)
      .health()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "network_error", status: 0 });
  });
});

describe("createApi — permintaan", () => {
  it("selalu memakai credentials same-origin agar cookie sm_session ikut", async () => {
    const { fetcher, calls } = recorder(() => jsonResponse({ skills: [] }));

    await createApi(fetcher).skills();

    expect(calls[0]?.path).toBe("/api/skills");
    expect(calls[0]?.init?.credentials).toBe("same-origin");
  });

  it("mengirim acknowledgeShared dan targets pada POST /api/installations", async () => {
    const { fetcher, calls } = recorder(() => jsonResponse({ results: [] }));

    await createApi(fetcher).install({
      skill: "alpha",
      targets: ["shared/global"],
      acknowledgeShared: true,
    });

    expect(calls[0]?.path).toBe("/api/installations");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.credentials).toBe("same-origin");
    expect((calls[0]?.init?.headers as Record<string, string> | undefined)?.["content-type"]).toBe(
      "application/json",
    );
    expect(bodyOf(calls[0])).toEqual({
      skill: "alpha",
      targets: ["shared/global"],
      acknowledgeShared: true,
    });
  });

  it("mengirim DELETE /api/installations dengan body JSON", async () => {
    const { fetcher, calls } = recorder(() => jsonResponse({ results: [] }));

    await createApi(fetcher).uninstall({ skill: "alpha", targets: ["claude-code/global"] });

    expect(calls[0]?.path).toBe("/api/installations");
    expect(calls[0]?.init?.method).toBe("DELETE");
    expect(bodyOf(calls[0])).toEqual({ skill: "alpha", targets: ["claude-code/global"] });
  });

  it("meng-encode nama skill pada GET /api/skills/:name", async () => {
    const { fetcher, calls } = recorder(() => jsonResponse({ skill: {} }));

    await createApi(fetcher).skill("nama skill");

    expect(calls[0]?.path).toBe("/api/skills/nama%20skill");
  });

  it("memanggil seluruh endpoint kontrak 7", async () => {
    const { fetcher, calls } = recorder(() => jsonResponse({}));
    const api = createApi(fetcher);

    await api.health();
    await api.harnesses();
    await api.recheckHarnesses();
    await api.skills();
    await api.skill("alpha");
    await api.inspect({ type: "folder", path: "/tmp/alpha" });
    await api.importSkill({ stagingId: "stg_1" });
    await api.installations();
    await api.sync({ skill: "alpha", action: "restore" });
    await api.doctor();
    await api.depsPlan({ skill: "alpha" });
    await api.depsRun({ skill: "alpha" });
    await api.connect("claude-code");

    expect(calls.map((call) => `${call.init?.method ?? "GET"} ${call.path}`)).toEqual([
      "GET /api/health",
      "GET /api/harnesses",
      "POST /api/harnesses/recheck",
      "GET /api/skills",
      "GET /api/skills/alpha",
      "POST /api/skills/inspect",
      "POST /api/skills/import",
      "GET /api/installations",
      "POST /api/sync",
      "GET /api/doctor",
      "POST /api/deps/plan",
      "POST /api/deps/run",
      "GET /api/connect/claude-code",
    ]);
  });
});
