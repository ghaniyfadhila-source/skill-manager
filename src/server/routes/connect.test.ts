import { describe, expect, it } from "vitest";
import { createTestServer } from "./fixture.js";

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

describe("GET /api/connect/:harnessId", () => {
  it("mengembalikan URL installer tanpa menjalankan proses apa pun", async () => {
    const server = createTestServer();

    const response = await server.request("/api/connect/claude-code");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { url: string };
    expect(Object.keys(body)).toEqual(["url"]);
    expect(body.url).toMatch(/^https:\/\//);
    expect(server.runner.calls).toEqual([]);
  });

  it("mengembalikan URL untuk harness detected-only", async () => {
    const server = createTestServer();

    const response = await server.request("/api/connect/goose");

    expect(response.status).toBe(200);
    expect(((await response.json()) as { url: string }).url).toMatch(/^https:\/\//);
    expect(server.runner.calls).toEqual([]);
  });

  it("mengembalikan 404 harness_not_found untuk harness yang tidak dikenal", async () => {
    const response = await createTestServer().request("/api/connect/tidak-ada");

    expect(response.status).toBe(404);
    expect(((await response.json()) as ErrorBody).error.code).toBe("harness_not_found");
  });

  it("menolak akses tanpa cookie sesi dengan 401", async () => {
    const response = await createTestServer().request("/api/connect/claude-code", {
      omitCookie: true,
    });

    expect(response.status).toBe(401);
    expect(((await response.json()) as ErrorBody).error.code).toBe("unauthorized");
  });
});
