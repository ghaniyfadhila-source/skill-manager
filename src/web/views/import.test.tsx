import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImportView } from "./import.js";

const noop = (): void => {};

describe("§13 UI — Impor", () => {
  it("menampilkan formulir sumber sebelum apa pun diunduh", () => {
    const html = renderToStaticMarkup(
      <ImportView
        staged={null}
        busy={false}
        error={null}
        onInspect={noop}
        onImport={noop}
        onReset={noop}
      />,
    );

    expect(html).toContain("Impor skill");
    expect(html).toContain("Periksa isi");
    // Pratinjau belum ada, jadi tombol impor belum boleh muncul.
    expect(html).not.toContain("Impor skill ke Library");
    // Alur dua langkah harus dijelaskan, bukan diasumsikan.
    expect(html).toContain("staging");
  });

  it("menampilkan spinner saat sumber sedang diperiksa", () => {
    const html = renderToStaticMarkup(
      <ImportView
        staged={null}
        busy
        error={null}
        onInspect={noop}
        onImport={noop}
        onReset={noop}
      />,
    );

    expect(html).toContain("Mengunduh");
    expect(html).not.toContain("Periksa isi");
  });

  it("menampilkan pesan galat beserta tombol coba lagi", () => {
    const html = renderToStaticMarkup(
      <ImportView
        staged={null}
        busy={false}
        error="Sumber tidak ditemukan"
        onInspect={noop}
        onImport={noop}
        onReset={noop}
      />,
    );

    expect(html).toContain("Sumber tidak ditemukan");
    expect(html).toContain("Coba lagi");
  });

  it("menampilkan pohon berkas, ukuran, dan lisensi pada pratinjau", () => {
    const html = renderToStaticMarkup(
      <ImportView
        staged={{
          stagingId: "stg_abc",
          suggestedName: "brainstorming",
          totalBytes: 2048,
          license: "MIT",
          provenance: { type: "git", url: "https://x/y.git", ref: "main" },
          risky: { scripts: false, binary: false, escapingSymlink: false, messages: [] },
          files: [
            { path: "SKILL.md", bytes: 1024 },
            { path: "scripts/run.sh", bytes: 1024, risk: "scripts" },
          ],
        }}
        busy={false}
        error={null}
        onInspect={noop}
        onImport={noop}
        onReset={noop}
      />,
    );

    expect(html).toContain("Pratinjau isi");
    expect(html).toContain("brainstorming");
    expect(html).toContain("MIT");
    expect(html).toContain("SKILL.md");
    expect(html).toContain("scripts/run.sh");
    expect(html).toContain("git https://x/y.git#main");
    expect(html).toContain("Impor brainstorming ke Library");
  });

  it("menegaskan tidak ada penanda risiko saat sumber bersih", () => {
    const html = renderToStaticMarkup(
      <ImportView
        staged={{
          stagingId: "stg_bersih",
          suggestedName: "bersih",
          totalBytes: 10,
          risky: { scripts: false, binary: false, escapingSymlink: false, messages: [] },
          files: [{ path: "SKILL.md", bytes: 10 }],
        }}
        busy={false}
        error={null}
        onInspect={noop}
        onImport={noop}
        onReset={noop}
      />,
    );

    expect(html).toContain("Tidak ada penanda risiko");
  });

  it("menonjolkan penanda risiko sebelum memasang (spec §13)", () => {
    const html = renderToStaticMarkup(
      <ImportView
        staged={{
          stagingId: "stg_riskan",
          suggestedName: "riskan",
          totalBytes: 10,
          risky: {
            scripts: true,
            binary: true,
            escapingSymlink: true,
            messages: ["symlink menunjuk ke luar folder sumber"],
          },
          files: [{ path: "SKILL.md", bytes: 10 }],
        }}
        busy={false}
        error={null}
        onInspect={noop}
        onImport={noop}
        onReset={noop}
      />,
    );

    expect(html).toContain("Periksa sebelum memasang");
    expect(html).toContain("berisi skrip");
    expect(html).toContain("berisi berkas biner");
    expect(html).toContain("ada symlink keluar folder");
    expect(html).toContain("symlink menunjuk ke luar folder sumber");
  });
});
