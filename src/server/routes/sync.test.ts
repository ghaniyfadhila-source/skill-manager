import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createTestServer,
  jsonRequest,
  ok,
  seedSkill,
  storePath,
  type TestServer,
} from "./fixture.js";

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

interface SkillView {
  id: string;
  name: string;
  contentHash: string;
}

async function installedSkill(server: TestServer): Promise<string> {
  const skill = await seedSkill(server.fs);
  const response = await jsonRequest(server, "/api/installations", "POST", {
    skill: skill.name,
    targets: ["claude-code/global"],
  });
  expect(response.status).toBe(200);
  const modified = path.join(storePath("claude-code"), skill.name, "SKILL.md");
  ok(await server.fs.write(modified, "# diubah user\n"));
  return skill.name;
}

async function sync(server: TestServer, body: unknown): Promise<Response> {
  return jsonRequest(server, "/api/sync", "POST", body);
}

describe("POST /api/sync", () => {
  it("restore mengembalikan isi Store dari Library", async () => {
    const server = createTestServer();
    const name = await installedSkill(server);

    const response = await sync(server, { skill: name, action: "restore", confirm: true });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { skill: SkillView };
    expect(body.skill.name).toBe(name);
    const restored = path.join(storePath("claude-code"), name, "SKILL.md");
    expect(ok(await server.fs.readText(restored))).toBe("# brainstorming\n");
  });

  it("menolak menimpa tanpa konfirmasi eksplisit (AC-8)", async () => {
    const server = createTestServer();
    const name = await installedSkill(server);
    const modified = path.join(storePath("claude-code"), name, "SKILL.md");

    const response = await sync(server, { skill: name, action: "restore" });

    expect(response.status).toBe(409);
    expect(((await response.json()) as ErrorBody).error.code).toBe("confirmation_required");
    // Isi Store yang diubah user TIDAK boleh tersentuh.
    expect(ok(await server.fs.readText(modified))).toBe("# diubah user\n");
  });

  it("adopt memperbarui hash Library dari isi Store", async () => {
    const server = createTestServer();
    const name = await installedSkill(server);
    const before = (await (await server.request("/api/skills")).json()) as { skills: SkillView[] };

    const response = await sync(server, { skill: name, action: "adopt", confirm: true });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { skill: SkillView };
    expect(body.skill.contentHash).not.toBe(before.skills[0]?.contentHash);
  });

  it("menolak action di luar restore/adopt dengan 400", async () => {
    const response = await sync(createTestServer(), {
      skill: "brainstorming",
      action: "hapus",
      confirm: true,
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as ErrorBody).error.code).toBe("bad_request");
  });

  it("mengembalikan 404 skill_not_found untuk skill yang tidak ada", async () => {
    const response = await sync(createTestServer(), {
      skill: "tidak-ada",
      action: "restore",
      confirm: true,
    });

    expect(response.status).toBe(404);
    expect(((await response.json()) as ErrorBody).error.code).toBe("skill_not_found");
  });
});
