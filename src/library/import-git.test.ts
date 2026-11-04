import path from "node:path";
import { describe, expect, it } from "vitest";
import { SkillManagerError } from "../core/errors.js";
import { loadState } from "../core/state.js";
import { MemoryFileSystem } from "../fs/memory.js";
import { FakeProcessRunner } from "../fs/process-fake.js";
import type { FileSystem, FsResult } from "../fs/types.js";
import { importGitSkill } from "./import-git.js";

const ROOT = path.resolve(path.sep, "sm-git");
const DATA_ROOT = path.join(ROOT, "data");
const TEMP_ROOT = path.join(ROOT, "tmp");
const CLONE = path.join(TEMP_ROOT, "clone");
const FIXED_ID = "sk_01TEST0000000000000000000";
const FIXED_NOW = "2026-11-05T00:00:00.000Z";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const URL = "https://contoh.test/pemilik/skill.git";

function ok<T>(result: FsResult<T>): T {
  if (!result.ok) {
    throw new Error(`Operasi gagal: ${result.error.code} — ${result.error.message}`);
  }
  return result.value;
}

async function seedFile(
  fs: FileSystem,
  filePath: string,
  data: string | Uint8Array,
): Promise<void> {
  ok(await fs.mkdir(path.dirname(filePath), { recursive: true }));
  ok(await fs.write(filePath, data));
}

async function seedSkill(
  fs: FileSystem,
  dir: string,
  frontmatter: string,
  extras: Record<string, string> = {},
): Promise<void> {
  await seedFile(fs, path.join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n# Judul\n`);
  for (const [relativePath, content] of Object.entries(extras)) {
    await seedFile(fs, path.join(dir, relativePath), content);
  }
}

function importOptions(overrides: { ref?: string } = {}) {
  return {
    url: URL,
    ...overrides,
    tempRoot: TEMP_ROOT,
    newTempDirName: () => "clone",
    newSkillId: () => FIXED_ID,
    now: () => FIXED_NOW,
  };
}

function cloneRunner(ref = "main"): FakeProcessRunner {
  return new FakeProcessRunner()
    .on("git", ["clone", "--depth", "1", "--branch", ref, URL, CLONE], { type: "exit", code: 0 })
    .on("git", ["rev-parse", "HEAD"], { type: "exit", code: 0, stdout: `${COMMIT}\n` });
}

async function caught(run: Promise<unknown>): Promise<SkillManagerError> {
  try {
    await run;
  } catch (error) {
    if (error instanceof SkillManagerError) {
      return error;
    }
    throw error;
  }
  throw new Error("Impor seharusnya ditolak, tetapi berhasil.");
}

describe("importGitSkill — clone dangkal dan provenance", () => {
  it("meng-clone dengan --depth 1 lalu mencatat url, ref, dan commit", async () => {
    const fs = new MemoryFileSystem();
    await seedSkill(fs, CLONE, "name: brainstorming");
    const runner = cloneRunner();

    const result = await importGitSkill(fs, DATA_ROOT, runner, importOptions({ ref: "main" }));

    expect(runner.calls[0]?.command).toBe("git");
    expect(runner.calls[0]?.args).toEqual([
      "clone",
      "--depth",
      "1",
      "--branch",
      "main",
      URL,
      CLONE,
    ]);
    expect(runner.lastArgs).toEqual(["rev-parse", "HEAD"]);
    expect(result.skill).toMatchObject({
      id: FIXED_ID,
      name: "brainstorming",
      source: { type: "git", url: URL, ref: "main", commit: COMMIT },
      importedAt: FIXED_NOW,
    });
    expect(
      ok(await fs.readText(path.join(DATA_ROOT, "library", "brainstorming", "SKILL.md"))),
    ).toContain("name: brainstorming");
    const saved = await loadState(fs, DATA_ROOT);
    expect(saved.status).toBe("loaded");
    expect(saved.state.library.at(0)).toEqual(result.skill);
  });
});

describe("importGitSkill — penemuan folder skill", () => {
  it("menerima SKILL.md di root walaupun ada subdirektori lain berisi SKILL.md", async () => {
    const fs = new MemoryFileSystem();
    await seedSkill(fs, CLONE, "name: di-root");
    await seedSkill(fs, path.join(CLONE, "lain"), "name: lain");

    const result = await importGitSkill(
      fs,
      DATA_ROOT,
      cloneRunner(),
      importOptions({ ref: "main" }),
    );

    expect(result.skill.name).toBe("di-root");
  });

  it("menerima SKILL.md di tepat satu subdirektori kedalaman 1", async () => {
    const fs = new MemoryFileSystem();
    await seedSkill(fs, path.join(CLONE, "brainstorming"), "name: brainstorming");

    const result = await importGitSkill(fs, DATA_ROOT, cloneRunner(), importOptions());

    expect(result.skill.name).toBe("brainstorming");
    expect(
      ok(await fs.readText(path.join(DATA_ROOT, "library", "brainstorming", "SKILL.md"))),
    ).toContain("name: brainstorming");
  });

  it("menolak sumber tanpa SKILL.md dan menyebut kode yang stabil", async () => {
    const fs = new MemoryFileSystem();
    await seedFile(fs, path.join(CLONE, "README.md"), "# bukan skill\n");

    const error = await caught(importGitSkill(fs, DATA_ROOT, cloneRunner(), importOptions()));

    expect(error.code).toBe("skill_md_missing");
    expect(await fs.exists(path.join(DATA_ROOT, "library"))).toBe(false);
  });

  it("menolak sumber dengan dua subdirektori skill", async () => {
    const fs = new MemoryFileSystem();
    await seedSkill(fs, path.join(CLONE, "satu"), "name: satu");
    await seedSkill(fs, path.join(CLONE, "dua"), "name: dua");

    const error = await caught(importGitSkill(fs, DATA_ROOT, cloneRunner(), importOptions()));

    expect(error.code).toBe("skill_md_ambiguous");
    expect(error.message).toContain("satu");
    expect(error.message).toContain("dua");
  });
});

describe("importGitSkill — commit SHA", () => {
  it("meng-clone tanpa --branch lalu checkout SHA, dan mencatat commit hasil rev-parse", async () => {
    const fs = new MemoryFileSystem();
    await seedSkill(fs, CLONE, "name: dipin");
    const sha = "abcdef0123456789abcdef0123456789abcdef01";
    const runner = new FakeProcessRunner()
      .on("git", ["clone", "--depth", "1", URL, CLONE], { type: "exit", code: 0 })
      .on("git", ["checkout", sha], { type: "exit", code: 0 })
      .on("git", ["rev-parse", "HEAD"], { type: "exit", code: 0, stdout: `${sha}\n` });

    const result = await importGitSkill(fs, DATA_ROOT, runner, importOptions({ ref: sha }));

    expect(runner.calls.map((call) => call.args)).toEqual([
      ["clone", "--depth", "1", URL, CLONE],
      ["checkout", sha],
      ["rev-parse", "HEAD"],
    ]);
    expect(result.skill.source).toEqual({ type: "git", url: URL, ref: sha, commit: sha });
  });

  it("fetch commit dari origin bila checkout pertama gagal", async () => {
    const fs = new MemoryFileSystem();
    await seedSkill(fs, CLONE, "name: dipin");
    const sha = "abcdef0123456789abcdef0123456789abcdef01";
    const runner = new FakeProcessRunner()
      .on("git", ["clone", "--depth", "1", URL, CLONE], { type: "exit", code: 0 })
      .on("git", ["checkout", sha], { type: "exit", code: 1, stderr: "reference is not a tree" })
      .on("git", ["fetch", "--depth", "1", "origin", sha], { type: "exit", code: 0 })
      .on("git", ["checkout", "FETCH_HEAD"], { type: "exit", code: 0 })
      .on("git", ["rev-parse", "HEAD"], { type: "exit", code: 0, stdout: `${sha}\n` });

    const result = await importGitSkill(fs, DATA_ROOT, runner, importOptions({ ref: sha }));

    expect(runner.calls.map((call) => call.args)).toEqual([
      ["clone", "--depth", "1", URL, CLONE],
      ["checkout", sha],
      ["fetch", "--depth", "1", "origin", sha],
      ["checkout", "FETCH_HEAD"],
      ["rev-parse", "HEAD"],
    ]);
    expect(result.skill.source).toEqual({ type: "git", url: URL, ref: sha, commit: sha });
  });

  it("menolak SHA yang tidak bisa diambil dari origin", async () => {
    const fs = new MemoryFileSystem();
    await seedSkill(fs, CLONE, "name: dipin");
    const sha = "abcdef0123456789abcdef0123456789abcdef01";
    const runner = new FakeProcessRunner()
      .on("git", ["clone", "--depth", "1", URL, CLONE], { type: "exit", code: 0 })
      .on("git", ["checkout", sha], { type: "exit", code: 1 })
      .on("git", ["fetch", "--depth", "1", "origin", sha], { type: "exit", code: 128 });

    const error = await caught(importGitSkill(fs, DATA_ROOT, runner, importOptions({ ref: sha })));

    expect(error.code).toBe("git_ref_not_found");
  });
});

describe("importGitSkill — kebersihan direktori sementara", () => {
  it("menghapus direktori sementara setelah impor berhasil", async () => {
    const fs = new MemoryFileSystem();
    await seedSkill(fs, CLONE, "name: bersih");

    await importGitSkill(fs, DATA_ROOT, cloneRunner(), importOptions());

    expect(await fs.exists(CLONE)).toBe(false);
    expect(await fs.exists(TEMP_ROOT)).toBe(true);
  });

  it("menghapus direktori sementara saat impor gagal", async () => {
    const fs = new MemoryFileSystem();
    await seedFile(fs, path.join(CLONE, "README.md"), "# tidak ada skill\n");

    await caught(importGitSkill(fs, DATA_ROOT, cloneRunner(), importOptions({ ref: "main" })));

    expect(await fs.exists(CLONE)).toBe(false);
  });

  it("menghapus direktori sementara saat clone gagal", async () => {
    const fs = new MemoryFileSystem();
    await seedSkill(fs, CLONE, "name: apa-saja");
    const runner = new FakeProcessRunner().on(
      "git",
      ["clone", "--depth", "1", "--branch", "main", URL, CLONE],
      { type: "exit", code: 128, stderr: "repository not found" },
    );

    const error = await caught(
      importGitSkill(fs, DATA_ROOT, runner, importOptions({ ref: "main" })),
    );

    expect(error.code).toBe("git_clone_failed");
    expect(error.message).toContain("repository not found");
    // Perintah terakhir adalah clone itu sendiri, jadi argumennya dicek lewat lastArgs.
    expect(runner.lastArgs).toEqual(["clone", "--depth", "1", "--branch", "main", URL, CLONE]);
    expect(await fs.exists(CLONE)).toBe(false);
  });
});

describe("importGitSkill — validasi sumber", () => {
  it("menolak URL berskema selain https/http tanpa menjalankan git", async () => {
    const fs = new MemoryFileSystem();
    const runner = new FakeProcessRunner();

    for (const url of [
      "git@github.com:pemilik/skill.git",
      "git+ssh://git@contoh.test/skill.git",
      "file:///C:/rahasia/skill",
      "ftp://contoh.test/skill.git",
    ]) {
      const error = await caught(
        importGitSkill(fs, DATA_ROOT, runner, { ...importOptions(), url }),
      );
      expect(error.code).toBe("invalid_git_url");
    }
    expect(runner.calls).toHaveLength(0);
  });

  it("memakai HEAD bila ref tidak diberikan dan tetap mencatatnya", async () => {
    const fs = new MemoryFileSystem();
    await seedSkill(fs, CLONE, "name: tanpa-ref");
    const runner = new FakeProcessRunner()
      .on("git", ["clone", "--depth", "1", URL, CLONE], { type: "exit", code: 0 })
      .on("git", ["rev-parse", "HEAD"], { type: "exit", code: 0, stdout: `${COMMIT}\n` });

    const result = await importGitSkill(fs, DATA_ROOT, runner, importOptions());

    expect(runner.calls[0]?.args).toEqual(["clone", "--depth", "1", URL, CLONE]);
    expect(result.skill.source).toMatchObject({ type: "git", ref: "HEAD", commit: COMMIT });
  });

  it("melaporkan git yang tidak tersedia di PATH", async () => {
    const fs = new MemoryFileSystem();
    const runner = new FakeProcessRunner().on("git", ["clone", "--depth", "1", URL, CLONE], {
      type: "not_found",
    });

    const error = await caught(importGitSkill(fs, DATA_ROOT, runner, importOptions()));

    expect(error.code).toBe("git_not_available");
  });
});

describe("importGitSkill — nama direktori sementara", () => {
  it("menolak nama sementara yang bisa menghapus direktori di luar induk", async () => {
    const fs = new MemoryFileSystem();
    await seedSkill(fs, CLONE, "name: apa-saja");

    const error = await caught(
      importGitSkill(fs, DATA_ROOT, new FakeProcessRunner(), {
        ...importOptions(),
        newTempDirName: () => "..",
      }),
    );

    expect(error.code).toBe("temp_dir_failed");
    // ".." akan menunjuk induk TEMP_ROOT; guard mencegah penghapusan rekursifnya.
    expect(await fs.exists(ROOT)).toBe(true);
    expect(await fs.exists(CLONE)).toBe(true);
  });
});

describe("importGitSkill — URL", () => {
  it("memangkas spasi di sekitar URL sebelum dipakai dan dicatat", async () => {
    const fs = new MemoryFileSystem();
    await seedSkill(fs, CLONE, "name: spasi");

    const result = await importGitSkill(fs, DATA_ROOT, cloneRunner(), {
      ...importOptions(),
      url: `  ${URL}  `,
    });

    expect(result.skill.source).toEqual({ type: "git", url: URL, ref: "HEAD", commit: COMMIT });
  });
});
