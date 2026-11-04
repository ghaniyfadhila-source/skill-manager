import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { handleDialogKey } from "./ui.js";
import { DoctorView } from "./views/doctor.js";
import { HarnessesView } from "./views/harnesses.js";
import { MatrixView } from "./views/matrix.js";
import { SkillsView } from "./views/skills.js";

const noop = (): void => {};

describe("AC-11 — Skills", () => {
  it("menampilkan empty state saat Library kosong", () => {
    const html = renderToStaticMarkup(
      <SkillsView skills={[]} installations={[]} harnesses={[]} onOpen={noop} />,
    );

    expect(html).toContain("Belum ada skill");
    expect(html).not.toBe("");
  });

  it("menampilkan chip Target dan status drift untuk skill terpasang", () => {
    const html = renderToStaticMarkup(
      <SkillsView
        skills={[{ id: "sk_alpha", name: "alpha", source: { type: "folder", path: "/s/alpha" } }]}
        installations={[
          {
            skillId: "sk_alpha",
            skillName: "alpha",
            targetId: "claude-code/global",
            drift: "modified",
          },
        ]}
        harnesses={[]}
        onOpen={noop}
      />,
    );

    expect(html).toContain("alpha");
    expect(html).toContain("claude-code/global");
    expect(html).toContain("Drift: isi berubah");
    expect(html).toContain("folder /s/alpha");
  });
});

describe("AC-11 — Matrix", () => {
  it("menjelaskan bahwa belum ada Target managed saat harness belum terdeteksi", () => {
    const html = renderToStaticMarkup(
      <MatrixView
        skills={[{ id: "sk_alpha", name: "alpha" }]}
        installations={[]}
        harnesses={[]}
        onToggle={noop}
      />,
    );

    expect(html).toContain("Belum ada Target managed");
    expect(html).toContain("Harnesses");
  });

  it("menampilkan sel yang bisa diklik beserta teks statusnya", () => {
    const html = renderToStaticMarkup(
      <MatrixView
        skills={[{ id: "sk_alpha", name: "alpha" }]}
        installations={[
          {
            skillId: "sk_alpha",
            skillName: "alpha",
            targetId: "claude-code/global",
            drift: "clean",
          },
        ]}
        harnesses={[
          {
            id: "claude-code",
            name: "Claude Code",
            capability: "managed",
            detected: true,
            detectionReasons: [],
            targets: [{ id: "claude-code/global", label: "Claude Code" }],
          },
        ]}
        onToggle={noop}
      />,
    );

    expect(html).toContain('aria-label="Cabut alpha dari Claude Code (terpasang)"');
    expect(html).toContain("Terpasang");
  });
});

describe("AC-11 — Harnesses", () => {
  it("menampilkan empty state dan tombol Recheck saat tidak ada harness", () => {
    const html = renderToStaticMarkup(
      <HarnessesView harnesses={[]} onRecheck={noop} onConnect={noop} />,
    );

    expect(html).toContain("Belum ada harness terdeteksi");
    expect(html).toContain("Recheck");
  });

  it("menampilkan alasan deteksi, tingkat kemampuan, dan tombol Connect tanpa installer", () => {
    const html = renderToStaticMarkup(
      <HarnessesView
        harnesses={[
          {
            id: "cursor",
            name: "Cursor",
            capability: "detected",
            detected: true,
            detectionReasons: ["direktori ~/.cursor ada"],
            connect: { installUrl: "https://cursor.com" },
          },
        ]}
        onRecheck={noop}
        onConnect={noop}
      />,
    );

    expect(html).toContain("direktori ~/.cursor ada");
    expect(html).toContain("Detected-only");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
  });
});

describe("AC-11 — Doctor", () => {
  it("menampilkan ringkasan bersih saat laporan kosong", () => {
    const html = renderToStaticMarkup(
      <DoctorView
        report={{ missing: [], unmanaged: [], stale: [], tempDirs: [] }}
        onRefresh={noop}
        onCleanTemp={noop}
      />,
    );

    expect(html).toContain("Tidak ada masalah");
    expect(html).toContain("Bersihkan");
  });
});

describe("dialog konfirmasi", () => {
  it("menutup dialog dengan tombol Escape", () => {
    let closed = 0;
    const handled = handleDialogKey({ key: "Escape", preventDefault: noop }, () => {
      closed += 1;
    });

    expect(handled).toBe(true);
    expect(closed).toBe(1);
  });

  it("mengabaikan tombol lain", () => {
    let closed = 0;
    const handled = handleDialogKey({ key: "Tab", preventDefault: noop }, () => {
      closed += 1;
    });

    expect(handled).toBe(false);
    expect(closed).toBe(0);
  });
});
