import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SkillManagerError } from "../core/errors.js";
import { MemoryFileSystem } from "../fs/memory.js";
import { FakeProcessRunner } from "../fs/process-fake.js";
import type { FsResult } from "../fs/types.js";
import { assertDependencyTools, checkDependencyTool } from "./availability.js";
import { detectDependencies } from "./detect.js";
import { planDependencies } from "./plan.js";
import { runDependencies } from "./run.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  exec: vi.fn(),
  execFile: vi.fn(),
}));

const DATA_ROOT = path.join(path.resolve(path.sep), "sm-deps");
const SKILL_ID = "skill-a";
const SKILL_DIR = path.join(DATA_ROOT, "library", SKILL_ID);
const DEPS_DIR = path.join(DATA_ROOT, "deps", SKILL_ID);

const NPM_INSTALL = ["install", "--ignore-scripts"];
const UV_REQUIREMENTS = ["pip", "install", "-r", "requirements.txt"];

function ok<T>(result: FsResult<T>): T {
  if (!result.ok) {
    throw new Error(`Operasi gagal: ${result.error.code} — ${result.error.message}`);
  }
  return result.value;
}

async function seed(files: Record<string, string>): Promise<MemoryFileSystem> {
  const fs = new MemoryFileSystem();
  ok(await fs.mkdir(SKILL_DIR, { recursive: true }));
  for (const [name, text] of Object.entries(files)) {
    const filePath = path.join(SKILL_DIR, name);
    ok(await fs.mkdir(path.dirname(filePath), { recursive: true }));
    ok(await fs.write(filePath, text));
  }
  return fs;
}

function packageJson(dependencies: Record<string, string> = {}): string {
  return JSON.stringify({ name: "skill-a", dependencies }, null, 2);
}

function npmAvailable(): FakeProcessRunner {
  return new FakeProcessRunner().on("npm", ["--version"], {
    type: "exit",
    code: 0,
    stdout: "10.9.0\n",
  });
}

function uvAvailable(): FakeProcessRunner {
  return new FakeProcessRunner().on("uv", ["--version"], {
    type: "exit",
    code: 0,
    stdout: "uv 0.7.0\n",
  });
}

async function rejected(promise: Promise<unknown>): Promise<SkillManagerError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SkillManagerError) {
      return error;
    }
    throw error;
  }
  throw new Error("Operasi seharusnya gagal.");
}

describe("detectDependencies", () => {
  it("mendeteksi package.json sebagai npm dengan args instalasi default", async () => {
    const fs = await seed({
      "package.json": JSON.stringify({
        dependencies: { lodash: "^4" },
        devDependencies: { vitest: "^3" },
      }),
    });

    const commands = ok(
      await detectDependencies(fs, SKILL_DIR, { dataRoot: DATA_ROOT, skillId: SKILL_ID }),
    );

    expect(commands).toHaveLength(1);
    expect(commands[0]?.kind).toBe("npm");
    expect(commands[0]?.command).toBe("npm");
    expect(commands[0]?.args).toEqual(NPM_INSTALL);
    expect(commands[0]?.cwd).toBe(DEPS_DIR);
    expect(commands[0]?.dependencies).toEqual(expect.arrayContaining(["lodash", "vitest"]));
    expect(commands[0]?.reason).toContain("package.json");
  });

  it("mendeteksi requirements.txt sebagai uv pip install -r", async () => {
    const fs = await seed({ "requirements.txt": "# komentar\nrequests>=2\nflask\n" });

    const commands = ok(
      await detectDependencies(fs, SKILL_DIR, { dataRoot: DATA_ROOT, skillId: SKILL_ID }),
    );

    expect(commands).toHaveLength(1);
    expect(commands[0]?.kind).toBe("uv");
    expect(commands[0]?.command).toBe("uv");
    expect(commands[0]?.args).toEqual(UV_REQUIREMENTS);
    expect(commands[0]?.cwd).toBe(DEPS_DIR);
    expect(commands[0]?.dependencies).toEqual(["requests>=2", "flask"]);
  });

  it("mendeteksi pyproject.toml lewat [project] atau [tool.poetry]", async () => {
    const project = await seed({ "pyproject.toml": '[project]\nname = "contoh"\n' });
    const poetry = await seed({ "pyproject.toml": '[tool.poetry]\nname = "contoh"\n' });
    const lainnya = await seed({ "pyproject.toml": "[build-system]\nrequires = []\n" });

    const fromProject = ok(
      await detectDependencies(project, SKILL_DIR, { dataRoot: DATA_ROOT, skillId: SKILL_ID }),
    );
    const fromPoetry = ok(
      await detectDependencies(poetry, SKILL_DIR, { dataRoot: DATA_ROOT, skillId: SKILL_ID }),
    );
    const fromOther = ok(
      await detectDependencies(lainnya, SKILL_DIR, { dataRoot: DATA_ROOT, skillId: SKILL_ID }),
    );

    expect(fromProject).toHaveLength(1);
    expect(fromProject[0]?.kind).toBe("uv");
    expect(fromPoetry).toHaveLength(1);
    expect(fromPoetry[0]?.kind).toBe("uv");
    expect(fromOther).toHaveLength(0);
  });

  it("memakai requirements.txt sebagai satu-satunya perintah uv bila ada pyproject juga", async () => {
    const fs = await seed({
      "requirements.txt": "requests\n",
      "pyproject.toml": '[project]\nname = "contoh"\n',
    });

    const commands = ok(
      await detectDependencies(fs, SKILL_DIR, { dataRoot: DATA_ROOT, skillId: SKILL_ID }),
    );

    expect(commands).toHaveLength(1);
    expect(commands[0]?.args).toEqual(UV_REQUIREMENTS);
  });

  it("memakai metadata.requires hanya sebagai petunjuk tambahan", async () => {
    const fs = await seed({
      "package.json": packageJson({ lodash: "^4" }),
      "SKILL.md": "---\nname: skill-a\nmetadata:\n  requires: npm\n---\n\n# Skill\n",
    });

    const commands = ok(
      await detectDependencies(fs, SKILL_DIR, { dataRoot: DATA_ROOT, skillId: SKILL_ID }),
    );

    expect(commands).toHaveLength(1);
    expect(commands[0]?.reason).toContain("metadata.requires");
  });

  it("tidak membuat perintah hanya dari metadata.requires", async () => {
    const fs = await seed({
      "SKILL.md": "---\nname: skill-a\nmetadata:\n  requires: npm\n---\n\n# Skill\n",
    });

    const commands = ok(
      await detectDependencies(fs, SKILL_DIR, { dataRoot: DATA_ROOT, skillId: SKILL_ID }),
    );

    expect(commands).toEqual([]);
  });

  it("menolak package.json yang bukan JSON valid", async () => {
    const fs = await seed({ "package.json": "{ bukan json" });

    const result = await detectDependencies(fs, SKILL_DIR, {
      dataRoot: DATA_ROOT,
      skillId: SKILL_ID,
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error.code).toBe("io_error");
  });

  it("menolak skillId yang bisa keluar dari direktori deps", async () => {
    const fs = await seed({ "package.json": packageJson() });

    const result = await detectDependencies(fs, SKILL_DIR, {
      dataRoot: DATA_ROOT,
      skillId: "../luar",
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error.code).toBe("invalid_path");
  });

  it("tidak memakai ProcessRunner sama sekali saat mendeteksi", async () => {
    const fs = await seed({ "package.json": packageJson() });
    const runner = new FakeProcessRunner();

    ok(await detectDependencies(fs, SKILL_DIR, { dataRoot: DATA_ROOT, skillId: SKILL_ID }));

    expect(runner.calls).toHaveLength(0);
  });
});

describe("planDependencies", () => {
  it("menghasilkan args PERSIS install --ignore-scripts secara default", async () => {
    const fs = await seed({ "package.json": packageJson({ lodash: "^4" }) });

    const commands = ok(
      await planDependencies(fs, SKILL_DIR, { dataRoot: DATA_ROOT, skillId: SKILL_ID }),
    );

    expect(commands[0]?.args).toEqual(["install", "--ignore-scripts"]);
  });

  it("menghilangkan --ignore-scripts bila allowScripts true", async () => {
    const fs = await seed({ "package.json": packageJson({ lodash: "^4" }) });

    const commands = ok(
      await planDependencies(fs, SKILL_DIR, {
        dataRoot: DATA_ROOT,
        skillId: SKILL_ID,
        allowScripts: true,
      }),
    );

    expect(commands[0]?.args).toEqual(["install"]);
  });

  it("tidak mengubah argumen uv saat allowScripts true", async () => {
    const fs = await seed({ "requirements.txt": "requests\n" });

    const commands = ok(
      await planDependencies(fs, SKILL_DIR, {
        dataRoot: DATA_ROOT,
        skillId: SKILL_ID,
        allowScripts: true,
      }),
    );

    expect(commands[0]?.args).toEqual(UV_REQUIREMENTS);
  });

  it("tidak menjalankan proses saat plan disusun", async () => {
    const fs = await seed({ "package.json": packageJson() });
    const runner = new FakeProcessRunner();

    ok(await planDependencies(fs, SKILL_DIR, { dataRoot: DATA_ROOT, skillId: SKILL_ID }));

    expect(runner.calls).toHaveLength(0);
  });

  it("selalu mengisolasi cwd ke <dataRoot>/deps/<skillId>", async () => {
    const fs = await seed({
      "package.json": packageJson({ lodash: "^4" }),
      "requirements.txt": "requests\n",
    });

    const commands = ok(
      await planDependencies(fs, SKILL_DIR, { dataRoot: DATA_ROOT, skillId: SKILL_ID }),
    );

    expect(commands.map((command) => command.cwd)).toEqual([DEPS_DIR, DEPS_DIR]);
  });
});

describe("availability", () => {
  it("melaporkan npm tidak tersedia bila binary tidak ditemukan", async () => {
    const runner = new FakeProcessRunner().otherwise({ type: "not_found" });

    const status = await checkDependencyTool(runner, "npm");

    expect(status.available).toBe(false);
    expect(status.message).toContain("tidak ditemukan");
    expect(runner.calls.map((call) => call.args)).toEqual([["--version"]]);
  });

  it("melaporkan versi bila binary menjawab --version", async () => {
    const runner = new FakeProcessRunner().on("npm", ["--version"], {
      type: "exit",
      code: 0,
      stdout: "10.9.0\n",
    });

    const status = await checkDependencyTool(runner, "npm");

    expect(status.available).toBe(true);
    expect(status.version).toBe("10.9.0");
  });

  it("gagal jelas dengan dependency_tool_missing bila tool tidak ada", async () => {
    const runner = uvAvailable().otherwise({ type: "not_found" });

    const error = await rejected(assertDependencyTools(runner, ["npm"]));

    expect(error.code).toBe("dependency_tool_missing");
    expect(error.message).toContain("npm");
  });
});

describe("runDependencies", () => {
  it("menjalankan npm install persis setelah konfirmasi dan mengembalikan hasil", async () => {
    const fs = await seed({ "package.json": packageJson({ lodash: "^4" }) });
    const runner = npmAvailable().otherwise({
      type: "exit",
      code: 0,
      stdout: "added 1 package",
    });

    const report = await runDependencies({
      fs,
      runner,
      dataRoot: DATA_ROOT,
      skillId: SKILL_ID,
      skillDir: SKILL_DIR,
    });

    expect(report.ok).toBe(true);
    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.code).toBe(0);
    expect(report.results[0]?.stdout).toContain("added 1 package");
    expect(runner.lastArgs).toEqual(NPM_INSTALL);
    expect(runner.calls.at(-1)?.options.cwd).toBe(DEPS_DIR);
  });

  it("menyalin manifest ke direktori deps sebelum menjalankan", async () => {
    const fs = await seed({ "package.json": packageJson({ lodash: "^4" }) });
    const runner = npmAvailable().otherwise({ type: "exit", code: 0 });

    await runDependencies({
      fs,
      runner,
      dataRoot: DATA_ROOT,
      skillId: SKILL_ID,
      skillDir: SKILL_DIR,
    });

    expect(ok(await fs.readText(path.join(DEPS_DIR, "package.json")))).toContain("lodash");
  });

  it("tidak menjalankan instalasi bila npm tidak tersedia", async () => {
    const fs = await seed({ "package.json": packageJson() });
    const runner = new FakeProcessRunner().otherwise({ type: "not_found" });

    const error = await rejected(
      runDependencies({
        fs,
        runner,
        dataRoot: DATA_ROOT,
        skillId: SKILL_ID,
        skillDir: SKILL_DIR,
      }),
    );

    expect(error.code).toBe("dependency_tool_missing");
    expect(runner.calls.map((call) => call.args)).toEqual([["--version"]]);
  });

  it("menjalankan uv pip install -r requirements.txt dengan cwd terisolasi", async () => {
    const fs = await seed({ "requirements.txt": "requests\n" });
    const runner = uvAvailable().otherwise({ type: "exit", code: 0 });

    const report = await runDependencies({
      fs,
      runner,
      dataRoot: DATA_ROOT,
      skillId: SKILL_ID,
      skillDir: SKILL_DIR,
    });

    expect(report.results[0]?.args).toEqual(UV_REQUIREMENTS);
    expect(report.results[0]?.cwd).toBe(DEPS_DIR);
    expect(runner.calls.at(-1)?.options.cwd).toBe(DEPS_DIR);
  });

  it("menghilangkan --ignore-scripts saat allowScripts true", async () => {
    const fs = await seed({ "package.json": packageJson() });
    const runner = npmAvailable().otherwise({ type: "exit", code: 0 });

    const report = await runDependencies({
      fs,
      runner,
      dataRoot: DATA_ROOT,
      skillId: SKILL_ID,
      skillDir: SKILL_DIR,
      allowScripts: true,
    });

    expect(report.results[0]?.args).toEqual(["install"]);
    expect(runner.lastArgs).toEqual(["install"]);
  });

  it("tidak menjalankan apa pun bila skill tidak punya dependensi", async () => {
    const fs = await seed({ "SKILL.md": "# Skill tanpa dependensi\n" });
    const runner = new FakeProcessRunner();

    const report = await runDependencies({
      fs,
      runner,
      dataRoot: DATA_ROOT,
      skillId: SKILL_ID,
      skillDir: SKILL_DIR,
    });

    expect(report).toEqual({ ok: true, results: [] });
    expect(runner.calls).toHaveLength(0);
  });

  it("melaporkan kegagalan per perintah tanpa melempar", async () => {
    const fs = await seed({ "package.json": packageJson() });
    const runner = npmAvailable().otherwise({
      type: "exit",
      code: 1,
      stderr: "ERR! tidak ada jaringan",
    });

    const report = await runDependencies({
      fs,
      runner,
      dataRoot: DATA_ROOT,
      skillId: SKILL_ID,
      skillDir: SKILL_DIR,
    });

    expect(report.ok).toBe(false);
    expect(report.results[0]?.code).toBe(1);
    expect(report.results[0]?.stderr).toContain("tidak ada jaringan");
  });

  it("tidak menjalankan proses apa pun saat modul dependensi diimpor", async () => {
    vi.resetModules();

    await import("./detect.js");
    await import("./plan.js");
    await import("./availability.js");
    await import("./run.js");

    const childProcess = await import("node:child_process");
    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(childProcess.exec).not.toHaveBeenCalled();
    expect(childProcess.execFile).not.toHaveBeenCalled();
  });
});
