# Skill Manager — Spec v0.1

Status: draft untuk direview. Belum ada implementasi yang boleh dimulai sebelum dokumen ini disetujui.

## 1. Ringkasan

Skill Manager adalah alat lokal (CLI + UI di browser lokal) yang menyimpan satu Library skill kanonik, lalu memasang salinan skill itu ke direktori milik harness AI yang dipilih user, dan mencabutnya kembali per target. Tidak ada akun, cloud, telemetri, atau proses latar yang berjalan terus-menerus.

## 2. Masalah dan bukti

Tiga keluhan awal:

1. Skill A harus dipasang ke Claude Code, tapi belum tentu ada di opencode atau Codex.
2. Skill B ingin ada di opencode, tapi tidak di Codex atau Antigravity.
3. Skill bisa dimatikan, tapi user kesulitan menghapus/memasangnya kembali ke konfigurasi harness.

Kondisi nyata di mesin pengembangan (diukur, bukan diasumsikan):

| Direktori | Jumlah skill | Reparse point |
|---|---|---|
| `~/.hermes/skills` | 27 | 0 |
| `~/.config/goose/skills` | 27 | 0 |
| `~/.config/crush/skills` | 27 | 0 |
| `~/.config/devin/skills` | 27 | 0 |
| `~/.config/opencode/skills` | 38 | 0 |
| `~/.agents/skills` | 67 | 0 |
| `~/.claude/skills` | 28 | 0 |

`brainstorming/SKILL.md` memiliki hash SHA-256 identik di Hermes, Goose, `.agents`, dan Claude Code. Artinya: ratusan direktori hasil duplikasi, tanpa sumber kebenaran, dengan jumlah yang sudah tidak sinkron. Tidak ada satu pun tautan — semuanya salinan fisik.

## 3. Tujuan v0.1

- Satu Library kanonik berisi skill yang diimpor dari folder lokal, repo git, atau zip.
- Memasang satu skill ke beberapa Target sekaligus, dengan isolasi per harness bila harness memiliki Store eksklusif.
- Mencabut pemasangan dari satu Target tanpa menyentuh Library dan tanpa menyentuh Target lain.
- Mendeteksi drift antara Library dan Store.
- Memasang dependensi skill (npm/uv) hanya setelah persetujuan eksplisit.

## 4. Non-tujuan v0.1

- Toggle ON/OFF (dihapus, lihat ADR-0002). Operasi yang tersedia hanya pasang dan cabut.
- Marketplace/registry skill.
- Artefak selain skill: rules, commands, subagent, MCP server, AGENTS.md/CLAUDE.md.
- macOS. Distribusi berupa installer desktop bertanda tangan.
- Sinkronisasi antar mesin, riwayat versi skill di Library, rollback.
- Pemindaian otomatis seluruh home directory.

## 5. Model domain

Istilah mengikuti `GLOSSARY.md`.

- **Library** — satu-satunya sumber kebenaran isi skill. Lokasi: `%LOCALAPPDATA%\SkillManager\library` (Windows) / `$XDG_DATA_HOME/skillmanager/library` (Linux).
- **Store** — direktori fisik tempat pemasangan berada. Punya nol atau lebih member (harness).
- **Target** — pasangan (harness, scope) yang dipilih user. Setiap Target memetakan ke tepat satu Store.
- **Installation** — catatan bahwa sebuah skill dipasang di sebuah Store.
- **Materialization** — penyalinan isi skill dari Library ke Store.

### 5.1 Peta Store dan Target (v0.1)

| Store | Members | Eksklusif | Target yang tersedia |
|---|---|---|---|
| `~/.claude/skills` | Claude Code | ya | claude-code/global |
| `~/.config/opencode/skills` | opencode | ya | opencode/global |
| `~/.gemini/config/skills` | Antigravity | ya | antigravity/global |
| `~/.agents/skills` | Codex, Gemini, Cursor, Copilot, Amp, Zed, Roo, Kilo, Factory, DSH | tidak | shared/global |

Aturan:

- **Default opencode memakai Store eksklusifnya.** User dapat memilih "pasang ke grup shared" per Installation; bila dipilih, opencode menjadi member dari Store shared dan kehilangan isolasi (UI memperingatkan).
- Harness tanpa Store eksklusif (Codex) hanya dapat dicapai lewat grup shared. Menghapus dari grup shared menghapus untuk semua member-nya, dan UI wajib menyebutkan daftar member yang terdampak sebelum konfirmasi.
- Harness yang terdeteksi tapi tidak punya adapter di v0.1 berstatus **Detected-only**: terlihat di UI, tidak bisa dipasangi.

### 5.2 Tingkat kemampuan

`detected` (terlihat, tanpa akses tulis), `managed` (bisa dipasang/dicabut). v0.1 hanya punya dua tingkat ini; tidak ada tingkat toggle.

## 6. Keputusan arsitektur

- ADR-0001 — Library privat; materialization memakai salinan; tautan hanya opsi lanjutan untuk Claude Code, Codex, Roo.
- ADR-0002 — Tidak ada ON/OFF; uninstall berbasis Store.
- ADR-0003 — Rilis awal sebagai paket npm dengan UI di browser lokal.

## 7. Arsitektur perangkat lunak

Satu paket npm (TypeScript, ESM, Node >= 22.20), tanpa dependensi native.

### 7.1 Tech stack

| Lapisan | Pilihan |
|---|---|
| Bahasa / runtime | TypeScript ESM, Node >= 22.20 |
| Struktur | satu paket, `src/{core,adapters,fs,server,web,cli}` |
| Build | tsup (esbuild) untuk server/CLI, Vite untuk UI |
| UI | React 19 + Tailwind CSS |
| HTTP | Hono di atas `node:http` |
| Validasi | zod (manifest adapter, state, body request) |
| Test | Vitest; Playwright menyusul setelah UI stabil |
| Lint / format | Biome |
| CI | GitHub Actions, matrix `windows-latest` + `ubuntu-latest`, Node 22 dan 24 |
| Package manager | pnpm untuk pengembangan, npm untuk konsumen |

```
src/
  core/         domain murni: Skill, Library, Store, Installation, hash, drift
  adapters/     manifest JSON + resolver Target->Store + deteksi
  fs/           operasi filesystem: copy-with-hash, delete-guarded, realpath
  server/       HTTP server 127.0.0.1 + API JSON
  web/          UI (static, dibundel)
  cli/          entry point
```

Aturan modul:

- `core` tidak mengimpor `fs` nyata; semua I/O lewat antarmuka `FileSystem` agar bisa diuji dengan memori.
- `adapters` adalah **data**, bukan kode: satu file JSON per harness. Menambah harness = menambah file.
- `server` tidak pernah memegang logika domain; ia hanya memanggil `core`.

## 8. Manifest adapter

```json
{
  "id": "opencode",
  "name": "opencode",
  "tier": "managed",
  "detect": {
    "paths": ["~/.config/opencode"],
    "binaries": ["opencode"],
    "versionArgs": ["--version"]
  },
  "stores": [
    { "scope": "global", "path": "~/.config/opencode/skills", "exclusive": true }
  ],
  "readsShared": true,
  "connect": {
    "installUrl": "https://opencode.ai/docs",
    "docsUrl": "https://opencode.ai/docs"
  },
  "verified": {
    "at": "2026-11-05",
    "source": "https://opencode.ai/docs"
  }
}
```

Field `verified` wajib ada. Adapter tanpa `verified.at` tidak boleh berstatus `managed`. Manifest pengguna disimpan di `<dataRoot>/adapters/*.json` dan menimpa manifest bawaan dengan `id` yang sama.

## 9. State

File: `<dataRoot>/state.json`, ditulis atomik (tulis ke `state.json.tmp` lalu rename).

```json
{
  "schemaVersion": 1,
  "library": [
    {
      "id": "sk_01H...",
      "name": "brainstorming",
      "dirName": "brainstorming",
      "contentHash": "sha256:...",
      "source": { "type": "git", "url": "...", "ref": "main", "commit": "..." },
      "license": "MIT",
      "importedAt": "2026-11-05T00:00:00Z"
    }
  ],
  "installations": [
    {
      "skillId": "sk_01H...",
      "storeId": "~/.claude/skills",
      "mode": "copy",
      "installedHash": "sha256:...",
      "installedAt": "2026-11-05T00:00:00Z"
    }
  ],
  "projects": [],
  "settings": { "sharedGroupMembers": [] }
}
```

Disk adalah kebenaran. `state.json` adalah indeks yang dapat dibangun ulang lewat pemindaian; jangan pernah menyimpan satu-satunya salinan data di sini.

## 10. Alur utama

### 10.1 Deteksi

1. Baca manifest bawaan + manifest pengguna.
2. Untuk tiap adapter: cek `detect.paths` (expand `~`), cek `detect.binaries` pada PATH + direktori kandidat.
3. Verifikasi binary dengan `--version` dan timeout 5 detik; kegagalan tidak membatalkan deteksi berbasis path.
4. Simpan alasan deteksi ("ditemukan ~/.claude", "opencode --version menjawab").
5. Tombol **Recheck** menjalankan ulang langkah 1–3 tanpa restart.

### 10.2 Impor

- **Folder**: validasi `SKILL.md` ada, frontmatter bisa diparse, `name` sama dengan nama folder, ukuran <= 10 MiB dan <= 1000 file. Salin ke `library/<name>`.
- **Git**: clone dangkal ke direktori sementara, checkout commit yang di-pin, temukan `SKILL.md` (root atau satu subdirektori), salin. Catat `url`, `ref`, `commit`.
- **Zip**: ekstrak ke direktori sementara, tolak entri yang menunjuk keluar folder tujuan, lalu sama seperti folder.
- Tabrakan nama: impor ditolak dengan pesan yang menyebut skill yang sudah ada. Tidak ada penimpaan.

### 10.3 Pasang

1. Resolusi Target -> Store.
2. Bila Store shared, tampilkan daftar member terdampak.
3. Bila tujuan sudah ada: tampilkan konflik (bukan menimpa).
4. Salin, hitung hash tujuan, catat Installation.

### 10.4 Cabut

1. Hanya boleh menghapus direktori yang tercatat sebagai Installation dan hash-nya masih sama.
2. Bila hash berbeda (drift), tolak penghapusan otomatis dan minta user memilih.
3. Library tidak pernah disentuh. Menghapus dari grup shared menghapus untuk semua member dan memerlukan konfirmasi yang menyebut jumlahnya.

### 10.5 Sinkron dan drift

Status per Installation: `clean`, `modified`, `missing`, `unmanaged`.

- `modified`: hash di Store berbeda dari `installedHash`. Aksi: "kembalikan dari Library" (timpa, dengan konfirmasi) atau "adopsi perubahan" (perbarui hash Library).
- `missing`: direktori hilang; Installation ditandai usang dan dapat dipasang ulang.
- `unmanaged`: direktori ada di Store tapi tidak ada di state.

Tidak ada sinkronisasi otomatis. Sinkron hanya berjalan saat user menekan tombol.

### 10.6 Dependensi

1. Deteksi dari isi skill: `package.json` -> npm, `requirements.txt`/`pyproject.toml` -> uv. `metadata.requires` di frontmatter sebagai petunjuk tambahan.
2. Tampilkan perintah persis yang akan dijalankan.
3. Jalankan hanya setelah konfirmasi. Instalasi terisolasi per skill (<dataRoot>/deps/<skillId>).
4. `--ignore-scripts` sebagai default; mengizinkannya memerlukan konfirmasi terpisah.
5. Bila npm/uv tidak ada: berhenti dan beri tahu. App tidak pernah memasang package manager.

## 11. Permukaan CLI

```
skill-manager detect [--json]
skill-manager add <folder|git-url|zip> [--ref <ref>]
skill-manager list [--json]
skill-manager install <skill> --to <target[,target]> [--shared]
skill-manager uninstall <skill> --from <target[,target]>
skill-manager sync [--skill <name>] [--json]
skill-manager doctor
skill-manager serve [--port 0] [--no-open]
```

Semua perintah mendukung `--json` untuk diuji. Exit code bukan nol saat ada operasi yang ditolak.

## 12. UI

Dua tampilan utama (ADR: skill-centric):

1. **Skills** — daftar skill; tiap baris menampilkan chip Target tempat skill terpasang, status drift, dan sumber.
2. **Matrix** — grid skill x Target untuk melihat dan mengubah sekaligus.

Halaman pendukung: **Harnesses** (status deteksi, alasan, tingkat kemampuan, tombol Recheck dan Connect), **Detail skill** (isi folder, provenance, lisensi, dependensi, aktivitas pasang/cabut), **Doctor** (drift, konflik, Installation usang).

Tombol Connect hanya membuka URL resmi di browser. App tidak pernah menjalankan installer pihak ketiga.

## 13. Keamanan

- Server hanya mendengarkan `127.0.0.1` pada port acak; token per sesi wajib untuk setiap request; validasi header `Host`.
- Sebelum menulis atau menghapus: `realpath` tujuan dan pastikan berada di dalam Store yang diharapkan.
- Tidak pernah menghapus secara rekursif melewati tautan.
- Sebelum memasang skill dari jaringan: tampilkan pohon file, penanda risiko (ada `scripts/`, binary, symlink keluar folder), ukuran, lisensi, dan provenance.
- Tidak ada eksekusi kode skill saat impor, saat pasang, maupun saat startup. Hanya langkah dependensi (10.6) yang mengeksekusi, dan hanya atas permintaan eksplisit.

## 14. Penanganan kegagalan

- Setiap operasi tulis bersifat atomik atau dapat dibatalkan: salin ke direktori sementara di Store (`.skill-manager-tmp-*`), lalu rename.
- Bila proses mati di tengah, sisa direktori sementara dibersihkan pada `doctor`.
- Kegagalan satu Target dalam operasi multi-Target tidak membatalkan Target lain; hasil dilaporkan per Target.

## 15. Kriteria penerimaan

Semua harus lulus di Windows dan Linux, pada mesin bersih, tanpa jaringan kecuali yang disebut.

- **AC-1** `npx <pkg> serve` menyala; UI terbuka di `127.0.0.1` dengan port acak; request tanpa token ditolak.
- **AC-2** Deteksi menampilkan >= 4 harness beserta alasan deteksinya; harness yang dipasang setelah app berjalan muncul setelah tombol Recheck tanpa restart; harness tak dikenal dapat ditambahkan manual lewat manifest pengguna.
- **AC-3** Impor minimal dua skill bertipe berbeda untuk **setiap** metode (folder, git, zip) seperti pada matriks fixture (§16); semuanya muncul di Library dengan provenance, lisensi, dan hash.
- **AC-4** Memasang satu skill ke **semua** Target managed sekaligus berhasil, dan isi tiap Store cocok dengan Library (hash sama).
- **AC-5** Memasang skill ke Claude Code dan opencode saja menghasilkan salinan di `~/.claude/skills` dan `~/.config/opencode/skills`, sementara Store shared tidak berubah — sehingga Codex tidak melihatnya.
- **AC-6** Memasang ke grup shared memunculkan peringatan yang menyebut daftar member terdampak, dan setelah dikonfirmasi skill terlihat oleh seluruh member.
- **AC-7** Uninstall dari seluruh Target yang dipakai pada AC-3 dan AC-4 berhasil, hanya menghapus salinan, dan Library tetap utuh sehingga pemasangan ulang berjalan tanpa jaringan.
- **AC-8** Mengubah isi direktori di salah satu Store menghasilkan status `modified`; Sinkron mengembalikannya setelah konfirmasi; tanpa konfirmasi tidak ada penimpaan.
- **AC-9** Skill dengan `package.json` menampilkan daftar dependensi dan perintah yang akan dijalankan; tidak ada yang dieksekusi sebelum konfirmasi; dengan `--ignore-scripts` sesuai default.
- **AC-10** Tidak ada satu pun perintah instalasi atau penghapusan yang berjalan saat startup.
- **AC-11** Tombol Connect hanya membuka browser; tidak ada proses installer yang dijalankan app.
- **AC-12** `doctor` mendeteksi dan melaporkan: Installation dengan direktori hilang, direktori unmanaged di Store, dan sisa direktori sementara.

## 16. Matriks fixture

Tiga tipe skill, dipakai minimal dua tipe berbeda per metode impor:

- **A** — murni markdown, satu `SKILL.md` + `references/`.
- **B** — dengan `scripts/` dan `package.json` (menguji dependensi npm).
- **C** — dengan `requirements.txt` (menguji uv) dan aset biner kecil.

Satu skill yang sama diimpor lewat dua metode berbeda untuk menguji penolakan tabrakan nama.

## 17. Risiko dan hal yang belum terverifikasi

- Path skill Codex: dokumen resmi melakukan redirect keluar domain dan belum dapat diverifikasi. Konsekuensi: adapter Codex hanya lewat grup shared, dan statusnya ditandai perlu verifikasi ulang sebelum rilis.
- Perilaku mengikuti tautan untuk harness selain Claude Code, Codex, dan Roo belum terverifikasi. Karena itu default materialization adalah salinan.
- Antigravity menyimpan konfigurasi di `~/.gemini/config` (bukan `~/.antigravity`); deteksi harus memakai path itu.
- `~/.agents/skills` juga ditulis oleh CLI `npx skills` (terbukti dari `~/.agents/.skill-lock.json` di mesin ini). Konflik penulisan harus dianggap normal, bukan kasus tepi.
- Nama paket npm `skill-manager` sudah dipakai; rilis memakai nama scoped.

## 18. Roadmap setelah v0.1

1. Adapter tambahan: Hermes, Goose, Crush, Devin, Kimchi, Copilot, Cursor.
2. Scope project dengan registrasi folder eksplisit.
3. Artefak lain: rules, commands, subagent, MCP.
4. Distribusi desktop bertanda tangan (SignPath + GitHub Releases + winget + AppImage/deb).
5. Riwayat versi dan rollback di Library.
