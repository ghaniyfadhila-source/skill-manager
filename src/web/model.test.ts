import { describe, expect, it } from "vitest";
import { cellFor, driftLabel, sourceLabel, targetColumns } from "./model.js";
import type { HarnessInfo, InstallationView, SkillSummary } from "./types.js";

const claude: HarnessInfo = {
  id: "claude-code",
  name: "Claude Code",
  capability: "managed",
  detected: true,
  detectionReasons: ["~/.claude/skills ada"],
  storeIds: ["~/.claude/skills"],
  targets: [{ id: "claude-code/global", label: "Claude Code" }],
};

const shared: HarnessInfo = {
  id: "shared",
  name: "Grup shared",
  capability: "managed",
  detected: true,
  detectionReasons: ["~/.agents/skills ada"],
  storeIds: ["~/.agents/skills"],
  targets: [{ id: "shared/global", label: "Shared (Codex, Gemini, ...)" }],
};

const detectedOnly: HarnessInfo = {
  id: "cursor",
  name: "Cursor",
  capability: "detected",
  detected: true,
  detectionReasons: ["binary cursor di PATH"],
};

const alpha: SkillSummary = { id: "sk_alpha", name: "alpha" };

describe("targetColumns", () => {
  it("hanya memakai Target managed", () => {
    const columns = targetColumns([claude, shared, detectedOnly]);

    expect(columns.map((column) => column.id)).toEqual(["claude-code/global", "shared/global"]);
  });

  it("menurunkan Target dari id harness bila server tidak menyebutkannya", () => {
    const columns = targetColumns([{ ...claude, targets: undefined }]);

    expect(columns).toEqual([{ id: "claude-code/global", label: "Claude Code" }]);
  });

  it("menghapus Target ganda dan mengabaikan daftar kosong", () => {
    const columns = targetColumns([claude, { ...claude, name: "Duplikat" }, detectedOnly]);

    expect(columns).toHaveLength(1);
    expect(targetColumns([])).toEqual([]);
  });
});

describe("cellFor", () => {
  it("menandai Target yang belum terpasang", () => {
    expect(cellFor([], alpha, "claude-code/global")).toEqual({
      installed: false,
      status: "absent",
      label: "Tidak terpasang",
    });
  });

  it("memakai status drift dari server", () => {
    const installations: InstallationView[] = [
      { skillId: "sk_alpha", skillName: "alpha", targetId: "claude-code/global", drift: "clean" },
      { skillId: "sk_alpha", skillName: "alpha", targetId: "shared/global", drift: "modified" },
    ];

    expect(cellFor(installations, alpha, "claude-code/global")).toMatchObject({
      installed: true,
      status: "clean",
      label: "Terpasang",
    });
    expect(cellFor(installations, alpha, "shared/global")).toMatchObject({
      installed: true,
      status: "modified",
      label: "Drift: isi berubah",
    });
  });

  it("mencocokkan lewat nama skill bila id tidak tersedia", () => {
    const installations: InstallationView[] = [
      { skillName: "alpha", targetId: "claude-code/global", drift: "missing" },
    ];

    expect(cellFor(installations, alpha, "claude-code/global").status).toBe("missing");
  });

  it("tidak mencampur skill lain di Target yang sama", () => {
    const installations: InstallationView[] = [
      { skillId: "sk_beta", skillName: "beta", targetId: "claude-code/global", drift: "clean" },
    ];

    expect(cellFor(installations, alpha, "claude-code/global").installed).toBe(false);
  });
});

describe("teks status dan sumber", () => {
  it("membedakan drift dengan teks, bukan hanya warna", () => {
    expect(driftLabel("modified")).toBe("Drift: isi berubah");
    expect(driftLabel("missing")).toBe("Drift: direktori hilang");
    expect(driftLabel("unmanaged")).toBe("Tidak terkelola");
    expect(new Set([driftLabel("modified"), driftLabel("missing")]).size).toBe(2);
  });

  it("meringkas provenance sumber", () => {
    expect(
      sourceLabel({ type: "git", url: "https://x/y.git", ref: "main", commit: "abc1234" }),
    ).toBe("git https://x/y.git#main@abc1234");
    expect(sourceLabel({ type: "folder", path: "C:/skills/alpha" })).toBe("folder C:/skills/alpha");
    expect(sourceLabel({ type: "zip", path: "C:/unduhan/alpha.zip" })).toBe(
      "zip C:/unduhan/alpha.zip",
    );
    expect(sourceLabel(undefined)).toBe("sumber tidak diketahui");
  });
});
