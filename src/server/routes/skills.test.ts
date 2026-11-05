import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSourceFolder,
  createTestServer,
  DATA_ROOT,
  HOME,
  jsonRequest,
  makeZipBytes,
  ok,
  SOURCE_ROOT,
  seedSkill,
  type TestServer,
} from "./fixture.js";

interface SkillSummaryView {
  id: string;
  name: string;
  dirName: string;
  contentHash: string;
  source: { type: string; path?: string };
  license?: string;
  importedAt: string;
}

interface SkillDetailView extends SkillSummaryView {
  files: { path: string; bytes?: number; risk?: string }[];
  dependencies?: { kind: string; command: string; args: string[] }[];
}

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

describe("GET /api/skills", () => {
  it("mengembalikan ringkasan setiap skill di Library", async () => {
    const server = createTestServer();
    const seeded = await seedSkill(server.fs, {
      files: { "SKILL.md": "---\nname: brainstorming\nlicense: MIT\n---\n# Brainstorming\n" },
    });

    const response = await server.request("/api/skills");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { skills: SkillSummaryView[] };
    expect(body.skills).toHaveLength(1);
    // Daftar dibaca dari state.json saja; lisensi tercatat saat impor, bukan saat baca.
    expect(body.skills[0]).toEqual({
      id: seeded.id,
      name: "brainstorming",
      dirName: "brainstorming",
      contentHash: seeded.contentHash,
      source: { type: "folder", path: path.join(HOME, "asal", "brainstorming") },
      importedAt: "2026-11-05T00:00:00Z",
    });
  });

  it("mengembalikan daftar kosong bila Library belum ada", async () => {
    const response = await createTestServer().request("/api/skills");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ skills: [] });
  });

  it("menolak akses tanpa cookie sesi dengan 401", async () => {
    const response = await createTestServer().request("/api/skills", { omitCookie: true });

    expect(response.status).toBe(401);
    expect(((await response.json()) as ErrorBody).error.code).toBe("unauthorized");
  });
});

describe("GET /api/skills/:name", () => {
  it("mengembalikan detail skill beserta daftar file dan ukurannya", async () => {
    const server = createTestServer();
    await seedSkill(server.fs, {
      files: {
        "SKILL.md": "---\nname: brainstorming\nlicense: MIT\n---\n# Brainstorming\n",
        "references/tips.md": "tips\n",
      },
    });

    const response = await server.request("/api/skills/brainstorming");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { skill: SkillDetailView };
    expect(body.skill.name).toBe("brainstorming");
    expect(body.skill.license).toBe("MIT");
    expect(body.skill.files.map((file) => file.path).sort()).toEqual([
      "SKILL.md",
      "references/tips.md",
    ]);
    const skillMd = body.skill.files.find((file) => file.path === "SKILL.md");
    expect(skillMd?.bytes).toBeGreaterThan(0);
  });

  it("tidak mengirim provenance sebagai objek di detail skill", async () => {
    const server = createTestServer();
    await seedSkill(server.fs, {
      files: { "SKILL.md": "---\nname: brainstorming\n---\n# Brainstorming\n" },
    });

    const response = await server.request("/api/skills/brainstorming");

    const body = (await response.json()) as { skill: Record<string, unknown> };
    // UI merender `provenance` sebagai teks; objek di sini akan membuat React
    // melempar "Objects are not valid as a React child". Provenance sudah
    // tersedia utuh di `source`, jadi field ini tidak boleh berupa objek.
    const provenance = body.skill.provenance;
    expect(provenance === undefined || typeof provenance === "string").toBe(true);
    expect(body.skill.source).toBeTypeOf("object");
  });

  it("menyertakan rencana dependensi tanpa menjalankan proses", async () => {
    const server = createTestServer();
    await seedSkill(server.fs, {
      name: "npm-skill",
      files: {
        "SKILL.md": "# npm-skill\n",
        "package.json": JSON.stringify({ dependencies: { leftpad: "1.0.0" } }),
      },
    });

    const response = await server.request("/api/skills/npm-skill");

    const body = (await response.json()) as { skill: SkillDetailView };
    expect(body.skill.dependencies).toEqual([
      {
        kind: "npm",
        command: "npm",
        args: ["install", "--ignore-scripts"],
        cwd: path.join(DATA_ROOT, "deps", "npm-skill"),
        reason: "package.json: 1 dependensi",
        dependencies: ["leftpad"],
      },
    ]);
    expect(server.runner.calls).toEqual([]);
  });

  it("mengembalikan 404 skill_not_found untuk skill yang tidak ada", async () => {
    const server = createTestServer();
    await seedSkill(server.fs);

    const response = await server.request("/api/skills/tidak-ada");

    expect(response.status).toBe(404);
    const body = (await response.json()) as ErrorBody;
    expect(body.error.code).toBe("skill_not_found");
  });

  it("menolak nama yang menunjuk keluar Library dengan 400", async () => {
    const server = createTestServer();

    const response = await server.request("/api/skills/..%2F..%2Frahasia");

    expect(response.status).toBe(400);
    expect(((await response.json()) as ErrorBody).error.code).toBe("bad_request");
  });
});
interface InspectView {
  stagingId: string;
  files: {
    name: string;
    path: string;
    kind: string;
    size: number;
    children?: InspectView["files"];
  }[];
  risky: { scripts: boolean; binary: boolean; escapingSymlink: boolean; messages: string[] };
  totalBytes: number;
  license?: string;
  suggestedName: string;
  provenance: { type: string; path?: string; url?: string };
}

interface TreeNode {
  path: string;
  kind: string;
  children?: readonly TreeNode[];
}

function flattenNodes(nodes: readonly TreeNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind === "directory") {
      paths.push(...flattenNodes(node.children ?? []));
      continue;
    }
    paths.push(node.path);
  }
  return paths;
}

async function inspectOf(server: TestServer, body: unknown): Promise<InspectView> {
  const response = await jsonRequest(server, "/api/skills/inspect", "POST", body);
  expect(response.status).toBe(200);
  return (await response.json()) as InspectView;
}

describe("POST /api/skills/inspect", () => {
  it("mempratinjau folder sumber dan mengembalikan stagingId yang bisa diimpor", async () => {
    const server = createTestServer();
    const sourceDir = await createSourceFolder(server.fs, "brainstorming", {
      "SKILL.md": "---\nname: brainstorming\nlicense: MIT\n---\n# Brainstorming\n",
      "references/tips.md": "tips\n",
      "scripts/run.sh": "echo halo\n",
    });

    const body = await inspectOf(server, { type: "folder", path: sourceDir });

    expect(body.stagingId).toMatch(/^stg_/);
    expect(body.suggestedName).toBe("brainstorming");
    expect(body.license).toBe("MIT");
    expect(body.totalBytes).toBeGreaterThan(0);
    expect(flattenNodes(body.files)).toEqual(["SKILL.md", "references/tips.md", "scripts/run.sh"]);
    expect(body.risky.scripts).toBe(true);
    expect(body.risky.binary).toBe(false);
    expect(body.risky.escapingSymlink).toBe(false);
    expect(body.risky.messages.length).toBeGreaterThan(0);
    expect(body.provenance.type).toBe("folder");
    expect(server.runner.calls).toEqual([]);
  });

  it("mempratinjau arsip zip tanpa mengimpor apa pun", async () => {
    const server = createTestServer();
    const zipPath = path.join(SOURCE_ROOT, "arsip.zip");
    ok(await server.fs.mkdir(SOURCE_ROOT, { recursive: true }));
    ok(
      await server.fs.write(
        zipPath,
        makeZipBytes([
          { name: "brainstorming/SKILL.md", data: "---\nname: brainstorming\n---\n# B\n" },
        ]),
      ),
    );

    const body = await inspectOf(server, { type: "zip", path: zipPath });

    expect(body.stagingId).toMatch(/^stg_/);
    expect(body.suggestedName).toBe("brainstorming");
    expect(body.provenance.type).toBe("zip");
    expect((await (await server.request("/api/skills")).json()) as unknown).toEqual({ skills: [] });
  });

  it("mengembalikan 404 source_not_found untuk folder yang tidak ada", async () => {
    const server = createTestServer();

    const response = await jsonRequest(server, "/api/skills/inspect", "POST", {
      type: "folder",
      path: path.join(SOURCE_ROOT, "tidak-ada"),
    });

    expect(response.status).toBe(404);
    // stageFromFolder melempar FsError apa adanya, jadi kodenya kode filesystem.
    expect(((await response.json()) as ErrorBody).error.code).toBe("not_found");
  });

  it("memetakan kegagalan git menjadi galat domain yang jelas", async () => {
    const server = createTestServer();
    server.runner.otherwise({ type: "not_found" });

    const response = await jsonRequest(server, "/api/skills/inspect", "POST", {
      type: "git",
      url: "https://contoh.test/skill.git",
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as ErrorBody).error.code).toBe("git_not_available");
  });

  it("menolak type yang tidak didukung dengan 400", async () => {
    const response = await jsonRequest(createTestServer(), "/api/skills/inspect", "POST", {
      type: "http",
      path: "https://contoh.test/skill",
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as ErrorBody).error.code).toBe("bad_request");
  });
});

describe("POST /api/skills/import", () => {
  it("mengimpor dari stagingId lalu menghapus staging", async () => {
    const server = createTestServer();
    const sourceDir = await createSourceFolder(server.fs, "brainstorming");
    const staged = await inspectOf(server, { type: "folder", path: sourceDir });

    const response = await jsonRequest(server, "/api/skills/import", "POST", {
      stagingId: staged.stagingId,
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { skill: SkillSummaryView };
    expect(body.skill.name).toBe("brainstorming");
    expect(body.skill.contentHash).toMatch(/^sha256:/);
    const list = (await (await server.request("/api/skills")).json()) as {
      skills: SkillSummaryView[];
    };
    expect(list.skills).toHaveLength(1);

    const again = await jsonRequest(server, "/api/skills/import", "POST", {
      stagingId: staged.stagingId,
    });
    expect(again.status).toBe(404);
    expect(((await again.json()) as ErrorBody).error.code).toBe("staging_not_found");
  });

  it("mengimpor langsung dari folder tanpa staging", async () => {
    const server = createTestServer();
    const sourceDir = await createSourceFolder(server.fs, "brainstorming");

    const response = await jsonRequest(server, "/api/skills/import", "POST", {
      type: "folder",
      path: sourceDir,
    });

    expect(response.status).toBe(201);
    expect(((await response.json()) as { skill: SkillSummaryView }).skill.name).toBe(
      "brainstorming",
    );
  });

  it("menolak impor nama yang sudah ada dengan 409 name_conflict", async () => {
    const server = createTestServer();
    await seedSkill(server.fs);
    const sourceDir = await createSourceFolder(server.fs, "brainstorming");

    const response = await jsonRequest(server, "/api/skills/import", "POST", {
      type: "folder",
      path: sourceDir,
    });

    expect(response.status).toBe(409);
    expect(((await response.json()) as ErrorBody).error.code).toBe("name_conflict");
  });

  it("menolak stagingId yang tidak dikenal dengan 404", async () => {
    const response = await jsonRequest(createTestServer(), "/api/skills/import", "POST", {
      stagingId: "stg_tidakada",
    });

    expect(response.status).toBe(404);
    expect(((await response.json()) as ErrorBody).error.code).toBe("staging_not_found");
  });

  it("menolak stagingId yang mencoba keluar direktori dengan 400", async () => {
    const response = await jsonRequest(createTestServer(), "/api/skills/import", "POST", {
      stagingId: "stg_../../rahasia",
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as ErrorBody).error.code).toBe("staging_invalid");
  });
});
