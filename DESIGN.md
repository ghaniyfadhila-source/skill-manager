# DESIGN.md — Skill Manager (web UI)

Dokumen desain untuk antarmuka web `skill-manager serve`. Mode permukaan: **Operate**
(alat lokal untuk menyelesaikan tugas). Identitas visual: **index-card filing cabinet** —
rak berkas + tab pembatas + kartu indeks, gelap netral, satu aksen teal.

## Token warna

| Peran | Nilai |
|---|---|
| Ground halaman | `slate-950` (`body` `bg-slate-950 text-slate-100`) |
| Panel / kartu | `slate-900` (dengan `slate-800` untuk border dan divide) |
| Sidebar | `slate-900/40` di atas ground, border kanan/bawah `slate-800` |
| Teks utama | `slate-100` |
| Teks sekunder | `slate-300`/`slate-400`, meta `slate-500` |
| **Aksen brand** | `teal-400` (teks/tab aktif), `teal-500` (tombol primer), `#14b8a6` = `teal-500` |
| ok / terpasang | `emerald-*` |
| warn / drift / destruktif | `amber-*` |
| error | `rose-*` |
| netral | `slate-*` |

Strategi warna: Restrained — netral + satu aksen teal dipakai hanya untuk aksi utama,
pilihan/nav aktif, focus ring, dan link. Warna semantik tetap untuk status.

## Anti-pattern (dilarang)

- Tidak ada gradasi ungu/violet/fuchsia, tidak ada `bg-gradient-*`.
- Tidak ada gradasi teks: tidak ada `bg-clip-text` / `background-clip: text`.
- Aksen tidak dipakai untuk dekorasi; tidak ada display font di label/data; tidak ada
  motion dekoratif atau sekuens muat-berhalaman.

## Tipografi

- Satu family: sans sistem (default Tailwind). Mono (`font-mono`) untuk path, kode, hash, store id.
- Skala rem tetap, rasio ketat (1.125–1.2). Heading halaman `text-2xl font-semibold`,
  heading seksi `text-lg font-medium`. Label grup sidebar `text-[11px] uppercase tracking`.

## Layout & navigasi

App shell dua kolom (desktop ≥ `lg`):

- Sidebar kiri tetap `15rem`, `sticky`, tinggi layar, scroll sendiri.
  Isi: brand "Skill Manager" + catatan lokal, nav berkelompok
  (Library: Skills/Impor/Katalog · Pemasangan: Matrix/Harnesses · Perawatan: Doctor),
  footer tombol "Muat ulang data".
- Item nav aktif: `border-l-2 border-teal-400 bg-teal-500/10 text-teal-200`, `aria-current="page"`.
- Konten kanan: `max-w-5xl`, header/label per-layar di dalam konten, bukan di sidebar.
- Responsif: `< lg` sidebar berubah jadi header blok dengan nav gulir horizontal
  (grup ditampilkan sebagai satu baris), konten tetap di bawah. Tabel `overflow-x-auto`.
- Routing hash (`#/skills`, dst) tidak berubah.

## Komponen & keadaan

- Kartu/list: `rounded-lg border border-slate-800`, divide `divide-slate-800`.
- Chip: bulat penuh, tone `ok`/`warn`/`neutral` (emerald/amber/slate).
- Tombol primer: `bg-teal-500 text-slate-950` label semibold; sekunder: border slate.
- Focus ring aksen teal, semua komponen punya default/hover/focus/active/disabled/loading/error.
- Loading awal: skeleton baris (blok `animate-pulse bg-slate-800`), bukan spinner tengah.
- Spinner hanya untuk label status pendek (impor/katalog/detail).
- Empty state mengajari langkah berikutnya; error banner `role="alert"`; konfirmasi
  destruktif lewat dialog modal (fokus ke batal, Escape), aksen amber.

## Batas scope

Hanya markup/class di `src/web/` yang berubah. Handler `App.tsx`, API, domain, alur
konfirmasi, dan copy faktual dipertahankan.