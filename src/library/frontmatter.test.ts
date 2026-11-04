import { describe, expect, it } from "vitest";
import { SkillManagerError } from "../core/errors.js";
import { OFFICIAL_FRONTMATTER_FIELDS, parseFrontmatter } from "./frontmatter.js";

function skillMd(frontmatter: string, body = "# Judul\n"): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

function expectFrontmatterError(run: () => unknown, messagePart: string): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(SkillManagerError);
  const error = caught as SkillManagerError;
  expect(error.code).toBe("frontmatter_invalid");
  expect(error.message).toContain(messagePart);
}

describe("parseFrontmatter", () => {
  it("memparse key: value, string berkutip, dan mengembalikan body", () => {
    const parsed = parseFrontmatter(
      skillMd(
        [
          "name: brainstorming",
          'description: "Menemukan sudut pandang baru"',
          "license: 'MIT'",
          "allowed-tools: Read, Write",
        ].join("\n"),
        "# Brainstorming\n\nIsi skill.\n",
      ),
    );

    expect(parsed.data).toEqual({
      name: "brainstorming",
      description: "Menemukan sudut pandang baru",
      license: "MIT",
      "allowed-tools": "Read, Write",
    });
    expect(parsed.body).toBe("# Brainstorming\n\nIsi skill.\n");
  });

  it("memparse metadata bertingkat satu level", () => {
    const parsed = parseFrontmatter(
      skillMd(
        ["name: npm-skill", "metadata:", "  requires: npm", "  homepage: https://example.com"].join(
          "\n",
        ),
      ),
    );

    expect(parsed.data).toEqual({
      name: "npm-skill",
      metadata: { requires: "npm", homepage: "https://example.com" },
    });
  });

  it("mengabaikan baris kosong dan komentar", () => {
    const parsed = parseFrontmatter(
      skillMd(
        ["# komentar", "name: skill-a", "", "  # komentar berspasi", "license: MIT"].join("\n"),
      ),
    );

    expect(parsed.data).toEqual({ name: "skill-a", license: "MIT" });
  });

  it("menolak teks tanpa blok frontmatter", () => {
    expectFrontmatterError(() => parseFrontmatter("# Hanya markdown\n"), "frontmatter");
  });

  it("menolak blok frontmatter yang tidak ditutup", () => {
    expectFrontmatterError(() => parseFrontmatter("---\nname: skill-a\n"), "tidak ditutup");
  });

  it("menolak baris yang bukan key: value", () => {
    expectFrontmatterError(() => parseFrontmatter(skillMd("name skill-a")), "baris 2");
  });

  it("menolak string berkutip yang tidak ditutup", () => {
    expectFrontmatterError(() => parseFrontmatter(skillMd('description: "terbuka')), "baris 2");
  });

  it("mendaftarkan enam field resmi frontmatter", () => {
    expect(OFFICIAL_FRONTMATTER_FIELDS).toEqual([
      "name",
      "description",
      "license",
      "compatibility",
      "metadata",
      "allowed-tools",
    ]);
  });
});
