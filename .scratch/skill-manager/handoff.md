# HANDOFF — Skill Manager

> Tempel seluruh dokumen ini di awal sesi baru. Isinya menggantikan konteks percakapan sebelumnya.

## 0. Instruksi untuk agent berikutnya

Planning sudah **selesai dan disetujui**. Jangan mengulang wawancara desain; jangan mengubah keputusan di bawah tanpa membuka ADR baru. Implementasi boleh dimulai dari ticket 01 atau 12 di `.scratch/skill-manager/issues/` **setelah user mengizinkan**. Belum ada satu baris kode pun yang ditulis.

Repo: `C:\Users\thinkpad\Desktop\allMaProject\skillManager` (git, branch `main`, **belum ada commit**).
Mesin: Windows 11, Node 24.21, pnpm 12.8.1, **tidak ada Rust**. npm global bin: `%APPDATA%\npm`.

## 1. Produk

**Skill Manager** — alat lokal (CLI + UI di browser via `127.0.0.1`) yang menyimpan satu **Library** skill kanonik, memasang salinan ke direktori harness AI yang dipilih, dan mencabutnya per target. Tanpa akun, cloud, telemetri.

Masalah yang diselesaikan (dari user):
1. Skill A harus ada di Claude Code, belum tentu di opencode/Codex.
2. Skill B ingin ada di opencode, tapi tidak di Codex/Antigravity.
3. Skill bisa dimatikan tapi user kesulitan memasang/menghapusnya lagi.

**Bukti empiris di mesin user** (diukur, bukan asumsi): 27 skill × 4 harness (hermes, goose, crush, devin) + opencode 38 + `.agents` 67 + `.claude` 28, **tanpa satu pun reparse point** (semua salinan fisik), `brainstorming/SKILL.md` ber-hash identik di 4 lokasi. Duplikasi ~170 direktori tanpa sumber kebenaran.

## 2. Keputusan yang terkunci

| # | Keputusan |
|---|---|
| D1 | Library kanonik milik app + impor skill yang sudah ada (hybrid). Library **privat**, bukan `~/.agents/skills` |
| D2 | Materialization = **salinan** (copy), tautan hanya opsi lanjutan untuk Claude Code, Codex, Roo |
| D3 | **Tidak ada ON/OFF.** Hanya pasang dan cabut. Unit operasi = Store |
| D4 | Produk publik, open-source, **Windows + Linux** (macOS ditolak) |
| D5 | Distribusi awal: paket npm + UI browser lokal; installer desktop bertanda tangan menyusul (SignPath Foundation gratis untuk OSS) |
| D6 | Sumber skill: folder lokal, git (commit di-pin), zip. Marketplace/registry ditolak |
| D7 | Dependensi skill: deteksi dari `package.json`/`requirements.txt`/`pyproject.toml` + `metadata.requires`; npm + uv; terisolasi per skill; `--ignore-scripts` default; selalu butuh konfirmasi |
| D8 | Adapter v0.1 managed: Claude Code, opencode, Antigravity, grup shared `.agents/skills`; sisanya *Detected-only* |
| D9 | opencode default memakai Store eksklusifnya; opsi "pasang ke grup shared" tersedia dengan peringatan |
| D10 | Adapter = data (JSON manifest), bukan kode; manifest pengguna bisa menimpa |
| D11 | Scope project ditunda ke v0.2 (penyimpangan sadar dari permintaan awal user, sudah disetujui) |
| D12 | UI: skill-centric primary + matrix secondary; tombol Connect hanya membuka URL, tidak menjalankan installer |
| D13 | State: satu `state.json` berversi di data root; disk adalah kebenaran, state hanya indeks |
| D14 | Lisensi repo: Apache-2.0. Nama npm: paket **scoped** (nama `skill-manager` sudah dipakai) |
| D15 | Tech stack: TypeScript ESM + Node ≥22.20, satu paket, tsup + Vite, React 19 + Tailwind, Hono + zod, Vitest, Biome, CI matrix Windows/Linux Node 22 & 24 |

Detail & alasan: `docs/adr/0001..0005`.

## 3. Artefak yang sudah ada

- `GLOSSARY.md` — 8 istilah: Skill, Library, Store, Harness, Scope, Target, Installation, Materialization. **"Agent" sengaja tidak dipakai** (duplikat dari Harness); **"Activation" tidak ada** (ON/OFF dihapus).
- `docs/adr/0001-library-privat-dan-materialisasi-copy.md`
- `docs/adr/0002-uninstall-berbasis-store.md`
- `docs/adr/0003-distribusi-cli-npm-dulu.md`
- `docs/adr/0004-satu-paket-npm.md`
- `docs/adr/0005-react-vite-untuk-ui.md`
- `.scratch/skill-manager/spec.md` — spec lengkap (model, skema manifest/state, alur, keamanan, 12 AC, matriks fixture)
- `.scratch/skill-manager/issues/01..12` — 12 ticket, semua `Status: ready-for-agent`
- `.scratch/research/*.md` — 3 riset mentah (path harness, ekosistem/prior-art, constraint desktop) dengan URL sumber

## 4. Model domain (ringkas)

- **Library**: `%LOCALAPPDATA%\SkillManager\library` / `$XDG_DATA_HOME/skillmanager/library`
- **Store**: direktori fisik; punya nol atau lebih member (harness)
- **Target**: (harness, scope) → tepat satu Store
- **Installation**: skill ditempatkan di Store, dengan `installedHash`
- Drift: `clean` | `modified` | `missing` | `unmanaged`. Sinkron hanya manual.

Peta Store v0.1:
| Store | Member | Eksklusif |
|---|---|---|
| `~/.claude/skills` | Claude Code | ya |
| `~/.config/opencode/skills` | opencode | ya |
| `~/.gemini/config/skills` | Antigravity | ya |
| `~/.agents/skills` | Codex, Gemini, Cursor, Copilot, Amp, Zed, Roo, Kilo, Factory, DSH | tidak |

## 5. Fakta harness yang wajib diingat

- **12 harness membaca `~/.agents/skills`** → granularitas per-harness di sana mustahil tanpa toggle native (karena itu toggle dihapus, dan grup shared diberi peringatan).
- **Codex tidak punya direktori skill eksklusif** → hanya bisa lewat grup shared; path resminya belum terverifikasi (docs 308-redirect keluar domain).
- **Antigravity** menyimpan config di `~/.gemini/config` (bukan `~/.antigravity`) — sudah terverifikasi di mesin user.
- **`~/.codex/skills` tidak dipakai Codex** (mitos umum).
- **Cline: global mengalahkan project** (kebalikan harness lain). **Amp** punya 11 level precedence.
- **Windows**: junction tanpa privilege; `readdir withFileTypes` & `lstat` melaporkan junction sebagai symlink (`isDirectory()=false`) → **jangan pernah** memindai dengan `dirent.isDirectory()`; pakai `fs.realpath`. Link menggantung: `lstat` OK, `stat` ENOENT, `access` OK (jangan dipakai sebagai probe).
- Symlink **folder** aman; symlink **file di dalam** skill merusak walker Go/Rust/Python.
- `npx skills` (vercel-labs) sudah menulis `~/.agents` dan lockfile `.skill-lock.json` di mesin ini → konflik tulis adalah normal.
- Spec SKILL.md: `agentskills.io`, 6 field resmi (name, description, license, compatibility, metadata, allowed-tools); validator ketat menolak field extended Claude Code → "valid" ≠ "didukung target".
- Risiko: ~12% skill registry publik berisi payload berbahaya; spec tidak punya field signature.

## 6. Kriteria penerimaan v0.1 (ringkas)

AC-1 server loopback + token · AC-2 deteksi ≥4 harness + alasan + Recheck + manifest manual · AC-3 impor 2 tipe skill per metode (folder/git/zip) · AC-4 pasang ke semua Target managed · AC-5 isolasi (Claude+opencode saja, Codex tidak melihat) · AC-6 peringatan member grup shared · AC-7 uninstall dari semua Target, Library utuh · AC-8 drift + Sinkron dengan konfirmasi · AC-9 dependensi butuh konfirmasi, `--ignore-scripts` default · AC-10 tidak ada eksekusi saat startup · AC-11 Connect hanya membuka browser · AC-12 `doctor` melaporkan missing/unmanaged/tmp.

Fixture: tipe **A** markdown murni, **B** `scripts/`+`package.json`, **C** `requirements.txt`+aset biner.

## 7. Ticket (urutan yang disarankan)

01 scaffold CLI+server → 02 core domain + seam FileSystem + hashing → 03 manifest+deteksi+Recheck → 04 impor folder → 05 impor git/zip → 06 pasang multi-target → 07 cabut → 08 drift/sinkron/doctor → 09 dependensi → 10 UI → 11 fixture & uji integrasi → 12 verifikasi path (bisa paralel kapan saja).

## 8. Dilarang muncul lagi tanpa ADR baru

Toggle ON/OFF · marketplace/registry skill · artefak selain skill (rules/commands/subagent/MCP) · macOS · installer desktop bertanda tangan di v0.1 · sinkronisasi antar mesin · riwayat versi/rollback · pemindaian home rekursif · app menjalankan installer harness · app memasang package manager sendiri.

## 9. Yang belum terverifikasi

Path skill Codex; perilaku ikut-tautan untuk harness selain Claude/Codex/Roo; path Windows opencode/Devin/Kiro/Zed; persistence toggle per-skill Gemini/Cline/Roo/Kilo/Cursor/Copilot/Kiro/Antigravity/Windsurf/Zed; jumlah pasti insiden ClawHavoc. Tulis "tidak terverifikasi", jangan diisi asumsi.

## 10. Cara melanjutkan

1. Baca `GLOSSARY.md`, `docs/adr/`, lalu `.scratch/skill-manager/spec.md`.
2. Mulai dari ticket **01** (atau **12** jika ingin riset dulu).
3. Jangan menulis kode sebelum user memberi izin eksplisit.
