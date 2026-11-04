import path from "node:path";
import { describe, expect, it } from "vitest";
import { SkillManagerError } from "../core/errors.js";
import { MemoryFileSystem } from "../fs/memory.js";
import type { FileSystem, FsResult } from "../fs/types.js";
import { inspectSource } from "./inspect.js";

const ROOT = path.resolve(path.sep, "sm-inspect");
const SOURCE = path.join(ROOT, "sumber");
const OUTSIDE = path.join(ROOT, "rahasia", "kunci.txt");

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

async function seedRichSource(fs: FileSystem): Promise<void> {
  await seedFile(fs, path.join(SOURCE, "SKILL.md"), "---\nname: kaya\nlicense: MIT\n---\n# Kaya\n");
  await seedFile(fs, path.join(SOURCE, "LICENSE"), "Lisensi MIT\n");
  await seedFile(fs, path.join(SOURCE, "scripts", "setup.sh"), "echo jangan-dijalankan\n");
  await seedFile(
    fs,
    path.join(SOURCE, "assets", "logo.png"),
    new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  );
  await seedFile(fs, path.join(SOURCE, "references", "teknik.md"), "# Teknik\n");
  await seedFile(fs, OUTSIDE, "rahasia\n");
  ok(await fs.symlink(OUTSIDE, path.join(SOURCE, "tautan-keluar")));
  ok(await fs.symlink(path.join(SOURCE, "references"), path.join(SOURCE, "tautan-dalam")));
}

describe("inspectSource — pratinjau sebelum konfirmasi", () => {
  it("melaporkan pohon file, ukuran, jumlah file, dan penanda risiko", async () => {
    const fs = new MemoryFileSystem();
    await seedRichSource(fs);

    const result = await inspectSource(fs, SOURCE);

    expect(result.fileCount).toBe(5);
    expect(result.totalBytes).toBe(
      "---\nname: kaya\nlicense: MIT\n---\n# Kaya\n".length +
        "Lisensi MIT\n".length +
        "echo jangan-dijalankan\n".length +
        4 +
        "# Teknik\n".length,
    );
    expect(result.files.map((node) => node.name)).toEqual([
      "LICENSE",
      "SKILL.md",
      "assets",
      "references",
      "scripts",
      "tautan-dalam",
      "tautan-keluar",
    ]);
    expect(result.hasScriptsDir).toBe(true);
    expect(result.hasBinary).toBe(true);
    expect(result.hasEscapingSymlink).toBe(true);
    expect(result.risks.join(" ")).toContain("scripts");
    expect(result.risks.join(" ")).toContain("biner");
    expect(result.risks.join(" ")).toContain("tautan");
  });

  it("menyusun pohon direktori bertingkat dengan path relatif POSIX", async () => {
    const fs = new MemoryFileSystem();
    await seedFile(fs, path.join(SOURCE, "SKILL.md"), "---\nname: pohon\n---\n");
    await seedFile(fs, path.join(SOURCE, "a", "b", "c.txt"), "isi\n");

    const result = await inspectSource(fs, SOURCE);

    const a = result.files.find((node) => node.name === "a");
    expect(a).toMatchObject({ path: "a", kind: "directory" });
    expect(a?.children?.[0]).toMatchObject({ path: "a/b", kind: "directory" });
    expect(a?.children?.[0]?.children?.[0]).toMatchObject({
      path: "a/b/c.txt",
      kind: "file",
      size: 4,
    });
  });

  it("mengambil lisensi dari file LICENSE bila frontmatter tidak menyebutnya", async () => {
    const fs = new MemoryFileSystem();
    await seedFile(fs, path.join(SOURCE, "SKILL.md"), "---\nname: berlisensi\n---\n");
    await seedFile(fs, path.join(SOURCE, "LICENSE"), "\nApache-2.0\n\nIsi.\n");

    const result = await inspectSource(fs, SOURCE);

    expect(result.license).toBe("Apache-2.0");
  });

  it("tidak menandai tautan internal sebagai risiko", async () => {
    const fs = new MemoryFileSystem();
    await seedFile(fs, path.join(SOURCE, "SKILL.md"), "---\nname: rapi\n---\n");
    await seedFile(fs, path.join(SOURCE, "references", "a.md"), "# A\n");
    ok(await fs.symlink(path.join(SOURCE, "references"), path.join(SOURCE, "tautan-dalam")));

    const result = await inspectSource(fs, SOURCE);

    expect(result.hasEscapingSymlink).toBe(false);
    expect(result.hasScriptsDir).toBe(false);
    expect(result.hasBinary).toBe(false);
    expect(result.risks).toEqual([]);
    expect(result.license).toBeUndefined();
  });

  it("menolak sumber yang bukan direktori", async () => {
    const fs = new MemoryFileSystem();
    await seedFile(fs, path.join(SOURCE, "berkas.txt"), "x");

    await expect(inspectSource(fs, path.join(SOURCE, "berkas.txt"))).rejects.toBeInstanceOf(
      SkillManagerError,
    );
  });
});
