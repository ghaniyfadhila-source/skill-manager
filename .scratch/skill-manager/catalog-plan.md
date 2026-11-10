# Plan — Katalog skill GitHub (fitur catalog)

Rancangan disetujui: `.scratch/skill-manager/catalog-design.md`.
Gate tiap task: `pnpm run ci` hijau. Conventional commit, bahasa Indonesia.

## Task A — Impor subfolder dari monorepo

- `src/library/skill-source.ts`: tambah `resolveSkillDirectory(fs, root, subdir?)`.
  - `subdir` kosong -> perilaku lama (`findSkillDirectory`).
  - `subdir` ada -> validasi satu path relatif (tolak absolut, `..`, pemisah backslash
    traversal, keluar root), lalu pastikan ada `SKILL.md` di situ. Galat baru `invalid_subdir`.
- `src/library/staging.ts`: `stageFromGit` terima `subdir`; `StagingMeta.subdir?`;
  `importStaged` pakai `resolveSkillDirectory(root, meta.subdir)` (bukan `findSkillDirectory`).
- `src/server/routes/skills.ts`: schema `inspect` varian git tambah `subdir?: string`, teruskan.
- Test: `src/library/staging.test.ts` — subdir valid diimpor; subdir `..`/absolut/tidak ada ditolak;
  impor tahap dua menghormati subdir yang tersimpan.

## Task B — Modul katalog (seed + metadata hidup)

- `src/catalog/seed.ts`: `CatalogSeed` = `{ owner, repo, subdir?, ref?, name, description }`.
  Konstanta `CATALOG_SEED` berisi ~9 entri terkurasi (verified `SKILL.md` + frontmatter `name`).
- `src/catalog/github.ts`: `enrichCatalog(seed, fetch)` — ambil `stargazers_count` + `description`
  per repo unik; injectable fetcher supaya unit test tanpa jaringan; gagal -> fallback data seed
  (`stars` tidak ada).
- Test: `src/catalog/catalog.test.ts` — gabung tanda hidup saat fetch ok; fallback saat fetch gagal;
  satu panggilan per repo unik.

## Task C — Route `GET /api/catalog`

- `src/server/routes/catalog.ts`: baca seed, enrich lewat `fetch` global, balas
  `{ items }`. Item: `{ id, name, description, owner, repo, subdir?, ref?, url, stars? }`.
  Tandai `installed` bila nama sudah ada di Library (dari `loadState`).
- Daftarkan di `src/server/app.ts`.
- Test: `src/server/routes/catalog.test.ts` — fixture fetcher; fallback; item terisi `installed`.

## Task D — UI Katalog + alur Pasang

- `src/web/api.ts` + `types.ts`: `GET /api/catalog` -> `CatalogItem[]`.
- `src/web/views/catalog.tsx`: kartu (nama, `owner/repo`, deskripsi, bintang), dropdown Target
  managed, tombol "Pasang" (disabled saat busy/tanpa target).
- `src/web/App.tsx`: nav "Katalog", route `#/catalog`, handler `installFromCatalog`:
  - `inspect({ type:"git", url, ref, subdir })` -> `confirm.ask` menampilkan pratinjau singkat
    (nama, jumlah file, risiko) -> `importSkill({ stagingId })` bila belum di Library ->
    `confirmAndRun("install", api.install(...), ...)` ke target pilihan -> notice + `reload()`.
  - Bila skill sudah di Library: lewati inspect/import, langsung install.
- Test: `src/web/views.test.tsx` — kartu menampilkan repo/nama/deskripsi/bintang + Pasang;
  `api.test.ts` — `api.catalog()` parses `items`.

## Task E — Gate + verifikasi nyata

- `pnpm run ci` hijau.
- Manual: `skill-manager serve` -> Katalog -> pasang `anthropics/skills` `docx` -> pilih
  Claude Code -> folder muncul di `~/.claude/skills/<name>`.
- `graphify update .` lalu commit + push + CI GitHub hijau.

## Review focus

- Safe path `subdir`: traversal lintas OS (depan/sempang + `..`) ditolak — test Task A.
- Instalasi ulang skill yang sudah ada nama di Library tidak dobel-import — Task C/D.
- Konfirmasi grup shared saat target = store shared tidak kelewatan — Task D (pakai `confirmAndRun`).
- Katalog tidak boleh menggantung lain bila GitHub API down — fallback Task B/C.
- `core` tetap tidak menyentuh `node:fs`/jaringan — modul katalog di `src/catalog` + route di server.