import { describe, expect, it } from "vitest";
import { createTestServer, jsonRequest } from "./fixture.js";

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

describe("batas global route API", () => {
  it("membalas 404 JSON (bukan HTML) untuk path /api yang tidak dikenal, meski Accept text/html", async () => {
    const response = await createTestServer().request("/api/installations/tidak-ada", {
      headers: { Accept: "text/html" },
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(((await response.json()) as ErrorBody).error.code).toBe("not_found");
  });

  it("membalas 404 JSON untuk method yang tidak dilayani pada path API", async () => {
    const response = await jsonRequest(createTestServer(), "/api/skills", "POST", {});

    expect(response.status).toBe(404);
    expect(((await response.json()) as ErrorBody).error.code).toBe("not_found");
  });

  it("menolak Host non-loopback dengan 403 sebelum menyentuh domain", async () => {
    const response = await createTestServer().request("/api/installations", {
      headers: { Host: "evil.example" },
    });

    expect(response.status).toBe(403);
    expect(((await response.json()) as ErrorBody).error.code).toBe("forbidden");
  });

  it("menolak request tanpa cookie sesi dengan 401 pada route domain", async () => {
    const response = await createTestServer().request("/api/installations", { omitCookie: true });

    expect(response.status).toBe(401);
    expect(((await response.json()) as ErrorBody).error.code).toBe("unauthorized");
  });
});
