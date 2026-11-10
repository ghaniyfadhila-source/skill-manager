# Rencana Redesign UI — Skill Manager (sidebar)

Status: **rencana (shape)**. Belum ada kode, belum ada kontrak arah. Butuh persetujuan arah sebelum build.

## Konteks terikat (tidak boleh dilanggar)

- Nav menu lewat **sidebar**, bukan top pill bar.
- **Tanpa gradasi ungu** (purple/violet/fuchsia gradient) di area mana pun.
- **Tanpa gradasi teks** (`background-clip: text` / `bg-clip-text`) pada heading, label, atau apa pun.
- Semua copy, fungsi, endpoint, alur konfirmasi, dan perilaku saat ini dipertahankan. Redesign = ganti kulit + struktur; tidak menyentuh produk/domain/API (`web` tetap bicara via HTTP, `core`/`fs`/`server` tidak diubah).

## Mode & audiens

- **Mode: Operate** — visitor menyelesaikan tugas (kelola skill, pasang/cabut, cek drift).
- Audiens: developer di mesin sendiri, buka UI lokal `127.0.0.1` di sela kerja editor/terminal, ruangan redup.
- Sukses: lihat status library/instalasi dalam satu pandang, pasang/cabut cepat, tahu ada drift/masalah tanpa cari.

## Arah visual — rekomendasi

**"Index card filing cabinet" / rak berkas digital** — material rajin yang sudah akrab: kartu indeks, tab pembatas, map manila. Bukan kostum terminal (alat yang dioperasikan audiens = rut untuk mode Operate). Identitas berasal dari *rak + tab + kartu*, dibaca sebagai alat manajemen berkas, bukan dashboard gelap generik.

- **Ground**: gelap netral (zinc/slate dingin), karena scene kerja = samping editor/terminal redup.
- **Accent tunggal**: teal (`#14b8a6`-`#2dd4bf` range) untuk aksi utama, item nav aktif, focus ring, link. Bukan ungu.
- **Warna semantik dipertahankan** (Operate butuh vocabulary status): emerald=ok/installed, amber=warn/drift/destructive-confirm, rose=error, slate=netral. Tidak menumpuk accent untuk dekorasi.

**Alternatif (butuh lock salah satu, bukan gabungan):**
1. *Blueprint / schematic* — garis teknis tipis, densitas tabel, mono untuk path. Lebih "alat teknis", risiko terasa dingin.
2. *Editor workspace* — sidebar kiri + panel konten, kosakata IDE. Paling akrab, tapi paling dekat ke kategori-default (dan menu sidebar sudah mewajibkan pola ini).
3. *Peta jalur / transit map* — skill→harness sebagai rute. Kuat di layar Matrix, lemah untuk layar daftar biasa (Skills/Doctor).

Rekomendasi #1 + konfirmasi. TIDAK memakai ungu sebagai accent dalam varian mana pun.

## Sistem desain (token, diniatkan bukan final)

- **Warna** — Restrained (netral + 1 accent + semantik). Tab-tab: `ground` (panel), `surface` (kartu), `surface-2` (sidebar, sedikit lebih dingin/dari ground). Tidak ada `bg-gradient-*`, tidak ada `bg-clip-text`.
- **Tipografi** — satu family, stack sistem (default Tailwind sans / system-ui). Mono untuk path, kode, store id. Skala rem tetap, rasio ketat 1.125–1.2. Tidak ada display face.
- **Radius/Border** — satu bahasa: kartu `rounded-lg`, tombol/input konsisten, border tipis `border-slate-700/800`. Sudut sama di semua layar.
- **Spacing** — satu ritme (4px grid). Jarak atas heading > bawah heading.
- **Focus/state** — setiap komponen interaktif punya default/hover/focus/active/disabled/loading/error (Operate wajib). Focus ring teal-400 jelas.

## Layout & navigasi (berubah inti)

App shell dua kolom:

```
┌──────────┬──────────────────────────────┐
│ sidebar  │  header: judul layar + aksi  │
│ (nav     │                              │
│  tetap)  │  konten view                 │
│          │                              │
└──────────┴──────────────────────────────┘
```

- **Sidebar kiri tetap** (`w-60`), tinggi penuh, `position: sticky`/fixed. Isi:
  - Brand "Skill Manager" + status lokal (`127.0.0.1`, sesi cookie) di footer sidebar / bawah.
  - Grup nav (label kecil uppercase):
    - **Library**: Skills, Impor, Katalog
    - **Pemasangan**: Matrix, Harnesses
    - **Perawatan**: Doctor
  - Item aktif: background accent teal pekat + teks terang, `aria-current="page"`. Item lain hover `bg-slate-800`.
- **Responsive**: `< lg` sidebar menyempit ke kolom ikon; `< md` jadi drawer overlay (tombol hamburger), backdrop menutup. Konten tetap scroll; tabel overflow-x.
- `href` hash tetap (`#/skills`, dst) — routing `useRoute` tidak diubah.
- Pindahkan aksi "Muat ulang data" dari header global ke header per-layar (di tempat konteksnya), atau tetap di pojok kanan atas konten. Per-layar disarankan.

## Per-layar (apa berubah, apa tetap)

Semua pemetaan data & handler di `App.tsx` tidak diubah; hanya markup/class views + `ui.tsx`.

1. **Skills** — daftar kartu/tabel dengan chip Target + drift. Pertahankan chip semantik. Tombol nama skill tetap link teal, `underline-offset`. Empty state tetap "mengajari" (perintah `add`, arah ke Harnesses).
2. **Impor** — form + pratinjau staging + penanda risiko. Form-control diseragamkan (label jelas, error inline). Tidak ada perubahan alur `inspect → import`.
3. **Katalog** — grid/repo list dengan pilih harness + tombol pasang. Select harness diseragamkan. Busy state per item.
4. **Matrix** — tabel grid skill×target. Sel tetap tombol satu-klik (✓/!/+), warna emerald/amber/slate dipertahankan. Sticky header kolom saat tabel lebar.
5. **Harnesses** — kartu per harness, chip detected/capability, alasan deteksi, tombol Connect. Pertahankan teks "hanya buka situs resmi".
6. **Doctor** — empat section temuan (missing/unmanaged/stale/temp). Jumlah temuan di header. Tombol "Bersihkan temp" tetap amber (destructive-ish, pakai konfirmasi).
7. **Detail** (skill) — breadcrumb/back link ke Skills, metadata file tree, dependensi, riwayat pasang. Tombol "Jalankan dependensi" dan "Kembalikan dari Library" tetap lewat konfirmasi.

## Keadaan & rentang (Operate)

- **Loading**: skeleton baris/kartu, bukan spinner tengah konten. Spinner hanya untuk label status pendek.
- **Empty**: empty state yang mengajarkan langkah berikutnya (sudah ada, pertahankan, restyle).
- **Error**: banner rose dengan `role="alert"`, kode error mono, tombol "Coba lagi".
- **Busy/disabled**: toggle Matrix disable 1 saat proses; label `aria-busy`.
- **Konfirmasi destruktif**: dialog tetap (aria-modal, fokus ke batal, Escape), restyle ke aksen amber. Tidak diganti modal sembarangan.
- **Overflow**: konten panjang (path, nama skill panjang) truncate + `title`, tabel scroll-x.

## Anti-goal eksplisit

- Tanpa `bg-gradient-*`, tanpa `bg-clip-text`, tanpa ungu/violet/fuchsia.
- Tanpa font display di label/data.
- Tanpa motion dekoratif / sekuens page-load; transisi 150–250 ms untuk state saja.
- Tanpa komponen stock yang menyimpang dari satu vocabulary.
- Tidak menyentuh logika domain/API/CLI (`core`, `fs`, `adapters`, `library`, `install`, `maintenance`, `server`, `cli`).
- Tidak mengubah copy faktual atau klaim produk.

## Fase implementasi (urutan)

1. Lock arah visual (#1 vs alternatif) — pemilik putuskan.
2. Siapkan token (CSS variables / tema Tailwind) — warna, spacing, radius; hapus top pill nav.
3. Bangun app shell: sidebar + header + layout responsif; pasang arah item nav aktif.
4. Restyle `ui.tsx` (Chip, EmptyState, ErrorBanner, ConfirmDialog, Spinner→skeleton).
5. Restyle per-view satu per satu (Skills → Impor → Katalog → Matrix → Harnesses → Doctor → Detail).
6. Responsive: ikon-sidebar + drawer mobile; cek tabel overflow.
7. Pass kualitas: a11y (focus, `aria-current`, kontras), motion state-only, perf. Screenshot desktop/mobile diukur.
8. Rekaman: sinkronkan token ke DESIGN.md (belum ada — `init`/`document` sebagai tindak lanjut).

## Keputusan terbuka (butuh pemilik)

- Varian arah: **"index card filing cabinet" (rekomendasi)** / blueprint / editor workspace / transit-map.
- Gelap vs terang: rekomendasi **gelap** (scene terminal). Boleh dibalik.
- Accent: **teal** disarankan; alternatif non-ungu lain = emerald atau amber.

## Asumsi yang ditandai (subagent, tanpa loop tanya-jawab)

- Mode Operate, audiens developer lokal (dari README + code).
- Accent teal, ground gelap — belum dikunci pemilik.
- Sidebar masuk ke semua 7 rute; detail skill = sub-layar dalam Skills.
- Tidak ada aset raster baru dibutuhkan (murni CSS komponen); kalau arah pilih butuh tekstur/ilustrasi, ditandai di tahap build.