# Rancangan fitur Katalog (catalog)

Status: disetujui 2026-11-10.

## Maksud

Layar baru "Katalog" di UI: daftar skill terpercaya yang sedang populer di
GitHub. Tiap kartu menampilkan nama repo + nama skill + deskripsi + jumlah
bintang, dengan tombol "Pasang". User memilih harness, skill terpasang tanpa
perintah manual.

## Gol / non-gol

- **Gol**: lihat katalog, lihat deskripsi, pasang satu skill ke satu harness pilihan.
- **Non-gol**: marketplace penuh, pencarian GitHub bebas, auto-update skill
  terpasang, rating/ulasan. Skill offensive-security dikecualikan dari seed
  (definisi "terpercaya" di sini tidak mencakup itu).

## Bagian

1. **Sumber katalog (cara C).** Berkas `catalog.json` ter-bundle berisi
   allowlist terkurasi: `{ owner, repo, subdir?, ref?, name, description }`.
   Ini = "terpercaya". Saat UI dibuka, server ambil bintang + deskripsi repo
   dari GitHub API untuk tiap repo (sekali per request, cache proses), gabung
   ke kartu = "tren". Gagal/rate-limit -> fallback ke data bundel.

2. **Impor subfolder dari monorepo.** `stageFromGit`/`inspect`/`importStaged`
   ditambah param `subdir` (satu path relatif; ditolak bila `..`/absolut/keluar).
   Repo seperti `anthropics/skills` adalah monorepo, sehingga "nama repo DAN
   skill" baru terwujud lewat ini.

3. **Alur "Pasang".** Klik Pasang -> dialog pilih harness (dropdown Target
   managed) -> bila skill belum di Library: `inspect(git+subdir)` -> pratinjau
   singkat (nama, file, risiko) -> `import` -> `install(target)`. Bila sudah ada:
   langsung `install(target)`. Konfirmasi grup shared lewat `confirm.ts` yang ada.
   Pasang tidak destruktif, jadi tidak ada prompt drift.

4. **UI.** Nav baru "Katalog" (`#/catalog`), kartu grid dengan deskripsi +
   bintang, tombol Pasang disabled saat memproses. Pilih harness = dropdown,
   satu target per aksi (pasang banyak sekaligus tetap lewat Matrix).

## Keputusan (panggilan builder)

- Isi seed allowlist persis; verifikasi tiap `subdir` punya `SKILL.md` sebelum
  commit. Awal: `obra/superpowers`, `anthropics/skills`, `wshobson/agents`.
- `ref` default `HEAD` (cabang utama); commit Aktual dicatat di provenance.
- Deskripsi kartu = kurasi manual + bintang live; deskripsi dari `SKILL.md`
  tidak di-clone per item (mahal untuk daftar).

## Batas

- Tidak menyentuh `core`.
- Medium: 1 route baru, 1 view baru, perluasan impor subfolder, ~4 berkas test.