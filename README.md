# Skill Manager

Satu gudang pusat untuk skill AI, dipasang ke banyak harness sekaligus.

Setiap harness punya folder skill sendiri — `~/.claude/skills`, `~/.config/opencode/skills`,
`~/.agents/skills`, dan seterusnya. Kalau kamu memakai lebih dari satu harness, skill yang
sama akan tersalin berkali-kali, lalu perlahan berbeda isinya karena diedit di tempat yang
berbeda. Tidak ada yang tahu versi mana yang benar.

Skill Manager menyimpan **satu** salinan kanonik di Library miliknya sendiri, lalu menyalinnya
ke folder harness yang kamu pilih. Library adalah sumber kebenaran: kalau salinan di harness
berubah, aplikasi bisa memberi tahu dan mengembalikannya.

## Yang bisa dilakukan

- **Impor** skill dari folder lokal, URL git, atau berkas zip — dengan pratinjau isi dan penanda risiko sebelum apa pun disimpan.
- **Pasang** satu skill ke beberapa harness sekaligus.
- **Cabut** per harness, tanpa menyentuh Library.
- **Deteksi drift**: tahu kalau salinan di harness sudah berbeda dari Library, lalu kembalikan atau adopsi perubahannya.
- **Periksa kesehatan** lewat `doctor`: salinan hilang, direktori asing, sisa berkas sementara.
- **Kelola dependensi** npm/uv — hanya ditampilkan dan dijalankan setelah kamu setujui.

Semua berjalan lokal di `127.0.0.1`. Tidak ada server, tidak ada akun, tidak ada telemetri.

## Pasang

> **Belum ada di npm registry.** Paket ini masih 0.1.0 dan dipasang langsung dari repositori.

```bash
git clone https://github.com/ghaniyfadhila-source/skill-manager.git
cd skill-manager
pnpm install
pnpm run build
node dist/cli.js serve
```

Butuh **Node.js >= 22.20** dan pnpm. Browser akan terbuka otomatis ke alamat dengan token
sekali pakai. Kalau tidak mau repot menulis `node dist/cli.js` terus-menerus:

```bash
npm link          # sekali saja, dari dalam folder repo
skill-manager serve
```

## Perintah

```bash
skill-manager detect                    # harness apa saja yang terpasang di mesin ini
skill-manager add <folder|url|zip>      # impor skill ke Library
skill-manager list                      # skill yang ada di Library
skill-manager install <skill> --to <target[,target]> [--shared]
skill-manager uninstall <skill> --from <target[,target]> [--force] [--shared]
skill-manager sync [--skill <nama>] [--adopt]
skill-manager doctor                    # laporan kesehatan
skill-manager serve [--port 0] [--no-open]
```

Semua perintah menerima `--json` untuk keluaran yang bisa diolah skrip.

Contoh:

```bash
skill-manager add https://github.com/user/skill-git.git --ref v1.2.0
skill-manager add ./skill-lokal
skill-manager add ~/unduhan/skill.zip
skill-manager install brainstorming --to claude-code/global,opencode/global
skill-manager uninstall brainstorming --from claude-code/global
```

Dua hal yang sengaja tidak dilakukan otomatis:

- **Folder asing tidak pernah ditimpa.** Kalau `~/.claude/skills/nama-skill` sudah ada tapi
  bukan hasil Skill Manager, pemasangan ditolak dengan `install_conflict` — bukan
  menimpanya diam-diam. Skill lama buatanmu tetap utuh.
- **Grup shared butuh persetujuan.** Memasang atau mencabut di `~/.agents/skills` mengubah
  skill yang terlihat oleh sepuluh harness sekaligus, jadi perintahnya ditolak dengan
  `shared_confirmation_required` sampai kamu menambahkan `--shared`.

## Harness yang didukung

| Harness | Tier | Folder |
|---|---|---|
| Claude Code | managed | `~/.claude/skills` |
| opencode | managed | `~/.config/opencode/skills` |
| Antigravity | managed | `~/.gemini/config/skills` |
| Shared | managed | `~/.agents/skills` |
| Hermes, Goose, Crush, Devin | hanya deteksi | — |

**Managed** berarti skill bisa dipasang ke sana. **Hanya deteksi** berarti aplikasi
menampilkannya sebagai informasi, tapi tidak menulis apa pun ke foldernya.

Store **Shared** (`~/.agents/skills`) dipakai bersama oleh banyak harness sekaligus —
Codex, Gemini, Cursor, Copilot, Amp, Zed, Roo, Kilo, Factory, dan DSH. Karena itu memasang
atau mencabut di sana akan meminta persetujuan lebih dulu, dengan menyebutkan harness mana
saja yang ikut terpengaruh.

Menambah harness baru = menambah satu berkas JSON di folder adapter. Tidak perlu menulis kode.

## Di mana datanya disimpan

| | Path |
|---|---|
| Windows | `%LOCALAPPDATA%\SkillManager` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/skillmanager` |

Bisa diubah dengan `SKILL_MANAGER_DATA_ROOT`. Isinya:

```
library/    salinan kanonik setiap skill
state.json  indeks: skill, installation, hash
staging/    unduhan sementara saat pratinjau impor
deps/       dependensi terisolasi per skill
```

Cakram adalah kebenaran, `state.json` hanya indeks. Kalau `state.json` rusak atau tidak
terbaca, aplikasi **tidak** menghapus apa pun: berkas lama diganti nama menjadi
`state.json.corrupt` dan diganti state kosong. Folder di `library/` tetap utuh, tapi
indeksnya kosong — **belum ada perintah untuk membangun ulang indeks dari isi folder**
di v0.1. Simpan salinan `state.json` kalau kamu punya banyak skill.

## Antarmuka web

`skill-manager serve` membuka UI lokal:

- **Skills** — daftar skill, isi folder, lisensi, dependensi, riwayat pemasangan.
- **Impor** — unduh ke staging, tampilkan pohon berkas dan penanda risiko, baru impor.
- **Matrix** — grid skill × harness untuk melihat dan mengubah pemasangan sekaligus.
- **Harnesses** — harness yang terdeteksi, alasan deteksinya, tombol Connect.
- **Doctor** — salinan hilang, direktori asing, sisa berkas sementara.

**Connect** hanya membuka halaman resmi harness di tab baru. Aplikasi tidak pernah
menjalankan installer pihak ketiga.

Server mengikat ke loopback saja, memeriksa header `Host` (menutup DNS rebinding), dan
mewajibkan token sekali pakai yang ditukar menjadi cookie `httpOnly`.

## Pengembangan

```bash
pnpm install
pnpm run ci      # lint + typecheck + test + build  ← gate wajib
```

Perintah lain: `pnpm run build`, `pnpm run test`, `pnpm run lint`, `pnpm run format`.

```
src/
  core/       domain murni: Skill, Library, Store, Installation, hash
  fs/         antarmuka FileSystem + implementasi Node + memori
  adapters/   manifest JSON per harness + loader + deteksi
  library/    impor folder/git/zip + staging pratinjau
  install/    pasang dan cabut
  maintenance/drift, sinkron, doctor
  deps/       deteksi dan eksekusi dependensi
  server/     HTTP API (Hono)
  web/        UI React
  cli/        entry point
```

Aturan: `core` tidak menyentuh `node:fs` (semua I/O lewat antarmuka `FileSystem` sehingga
bisa diuji dengan filesystem memori), `server` tidak memegang logika domain, dan `web`
hanya berbicara ke server lewat HTTP.

Test dijalankan di CI untuk **Windows dan Linux × Node 22 dan 24**.

## Batasan v0.1

Ini yang **belum** ada, supaya tidak ada kejutan:

- Hanya Windows dan Linux. macOS belum didukung.
- Belum ada perintah ON/OFF. Skill dipasang atau dicabut, tidak ada status "nonaktif".
- Materialisasi selalu **salinan**, bukan symlink.
- Tidak ada sinkronisasi antar mesin, riwayat versi, atau rollback.
- Satu `state.json` tunggal; belum ada migrasi skema otomatis.
- `doctor` melaporkan isi Library yang hilang, tapi tidak bisa memulihkannya dari Store —
  Store adalah salinan, bukan sumber.
- Kalau `state.json` rusak, indeks diganti kosong dan **tidak** dibangun ulang otomatis dari
  isi `library/`. Folder skill tetap ada di disk, tapi aplikasi belum bisa memakainya lagi
  sampai ada perintah rebuild (belum ada di v0.1).

## Lisensi

Apache-2.0.
