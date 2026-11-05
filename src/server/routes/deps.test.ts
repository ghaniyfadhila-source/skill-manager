import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTestServer, jsonRequest, seedSkill, type TestServer } from "./fixture.js";

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

interface DepCommandView {
  kind: string;
  command: string;
  args: string[];
  cwd: string;
  reason: string;
  dependencies: string[];
}

interface RunResultView {
  kind: string;
  command: string;
  args: string[];
  code: number | null;
  stdout: string;
  timedOut: boolean;
}

async function npmSkill(server: TestServer): Promise<void> {
  await seedSkill(server.fs, {
    name: "npm-skill",
    files: {
      "SKILL.md": "---\nname: npm-skill\n---\n# npm-skill\n",
      "package.json": JSON.stringify({ dependencies: { leftpad: "1.0.0" } }),
    },
  });
}

describe("POST /api/deps/plan", () => {
  it("mengembalikan perintah yang akan dijalankan tanpa mengeksekusinya", async () => {
    const server = createTestServer();
    await npmSkill(server);

    const response = await jsonRequest(server, "/api/deps/plan", "POST", { skill: "npm-skill" });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { commands: DepCommandView[] };
    expect(body.commands).toHaveLength(1);
    expect(body.commands[0]).toEqual({
      kind: "npm",
      command: "npm",
      args: ["install", "--ignore-scripts"],
      cwd: path.join(
        path.parse(path.resolve(path.sep)).root,
        "sm-server-data",
        "deps",
        "npm-skill",
      ),
      reason: "package.json: 1 dependensi",
      dependencies: ["leftpad"],
    });
    expect(server.runner.calls).toEqual([]);
  });

  it("mengembalikan daftar kosong untuk skill tanpa manifest", async () => {
    const server = createTestServer();
    await seedSkill(server.fs);

    const response = await jsonRequest(server, "/api/deps/plan", "POST", {
      skill: "brainstorming",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ commands: [] });
    expect(server.runner.calls).toEqual([]);
  });

  it("mengembalikan 404 skill_not_found untuk skill yang tidak ada", async () => {
    const response = await jsonRequest(createTestServer(), "/api/deps/plan", "POST", {
      skill: "tidak-ada",
    });

    expect(response.status).toBe(404);
    expect(((await response.json()) as ErrorBody).error.code).toBe("skill_not_found");
  });
});

describe("POST /api/deps/run", () => {
  it("memeriksa package manager lalu menjalankan install dengan --ignore-scripts", async () => {
    const server = createTestServer();
    await npmSkill(server);

    const response = await jsonRequest(server, "/api/deps/run", "POST", { skill: "npm-skill" });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; output: RunResultView[] };
    expect(body.ok).toBe(true);
    expect(body.output[0]?.args).toEqual(["install", "--ignore-scripts"]);
    expect(server.runner.calls.map((call) => [call.command, call.args])).toEqual([
      ["npm", ["--version"]],
      ["npm", ["install", "--ignore-scripts"]],
    ]);
  });

  it("melepas --ignore-scripts bila allowScripts diminta", async () => {
    const server = createTestServer();
    await npmSkill(server);

    const response = await jsonRequest(server, "/api/deps/run", "POST", {
      skill: "npm-skill",
      allowScripts: true,
    });

    expect(response.status).toBe(200);
    expect(server.runner.lastArgs).toEqual(["install"]);
  });

  it("berhenti dengan 400 bila package manager tidak tersedia", async () => {
    const server = createTestServer();
    await npmSkill(server);
    server.runner.otherwise({ type: "not_found" });

    const response = await jsonRequest(server, "/api/deps/run", "POST", { skill: "npm-skill" });

    expect(response.status).toBe(400);
    expect(((await response.json()) as ErrorBody).error.code).toBe("dependency_tool_missing");
  });

  it("tidak menjalankan install untuk skill tanpa manifest", async () => {
    const server = createTestServer();
    await seedSkill(server.fs);

    const response = await jsonRequest(server, "/api/deps/run", "POST", {
      skill: "brainstorming",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, output: [] });
    expect(server.runner.calls).toEqual([]);
  });
});
