# Handoff — Skill Manager v0.1 (sesi 2)

> Tempel dokumen ini di awal sesi berikutnya. Semua fakta di bawah sudah diverifikasi,
> bukan ingatan. Tanggal: 2026-11-05.

## Status satu baris

Skill Manager v0.1 **selesai, terbit di npm, dan berjalan**. Paket `@ghaniy_fadhil/skill-manager@0.1.1` bisa di-`npm install -g` dan sudah diuji di Windows asli. 466 test, CI hijau 4 job.

## Identitas proyek

| | |
|---|---|
| Repo lokal | `C:\Users\thinkpad\Desktop\allMaProject\skillManager` |
| Remote | https://github.com/ghaniyfadhila-source/skill-manager |
| Branch aktif | `main` (default branch di GitHub) |
| Commit terakhir | `0cbeb69` |
| Commit di atas titik awal | 71 |
| Paket npm | `@ghaniy_fadhil/skill-manager` (publik) |
| Versi terbit | `0.0.0-stage`, `0.1.0`, `0.1.1` (latest) |
| Akun npm | `ghaniy_fadhil` (bukan ghaniyfadhila-source) |
| Environment | Windows 11, Node v24.21.0, pnpm 12.8.1 |

Semua branch identik: `main` = `feat/v0.1` = `origin/main` = `origin/feat/v0.1` = `0cbeb69`.

## Apa yang dibangun

CLI + UI browser lokal untuk mengelola satu **Library** kanonik skill AI, lalu menyalinnya ke
folder **Store** milik banyak harness ([CC], opencode, Antigravity, Shared/.agents).

**Stack**: TypeScript ESM, Node >=22.20, Hono + zod, React 19 + Vite + Tailwind, Vitest, Biome,
tsup. Lisensi Apache-2.0.

### Struktur kode

```
src/
  core/        domain murni (TIDAK boleh impor node:fs): Skill, Library, Store, hash, state
  fs/          antarmuka FileSystem + implementasi Node + memori
  adapters/    8 manifest JSON (satu per harness) + loader + deteksi
  library/     impor folder/git/zip + staging pratinjau
  install/     pasang dan cabut
  maintenance/ drift, sinkron, doctor
  deps/        deteksi dan eksekusi dependensi
  server/      HTTP API (Hono), tidak memegang logika domain
  web/         UI React
  cli/         entry point, 8 perintah
```

Aturan penting: `core` tidak menyentuh `node:fs` (semua I/O lewat antarmuka `FileSystem` sehingga bisa diuji dengan filesystem memori). `web` hanya bicara ke server lewat HTTP.

### Store map

| Harness | Tier | Folder |
|---|---|---|
| `claude-code` ([CC]) | managed | `~/.claude/skills` |
| `opencode` | managed | `~/.config/opencode/skills` |
| `antigravity` | managed | `~/.gemini/config/skills` |
| `shared` | managed | `~/.agents/skills` (member: codex, gemini, cursor, copilot, amp, zed, roo, kilo, factory, dsh) |
| `hermes`, `goose`, `crush`, `devin` | detected-only | — |

## Gate

```bash
pnpm run ci    # lint && typecheck && test && build  <- WAJIB hijau sebelum commit
```

Sekarang: 50 file test, 466 test lolos. CI GitHub Actions: Windows + Linux x Node 22 + 24.

## Yang dikerjakan di sesi ini

1. **Layar impor UI** (`src/web/views/import.tsx`) — spec 13 sebelumnya mustahil dipenuhi
   karena tidak ada UI yang memanggil `api.inspect()`. Alur dua langkah lewat staging.
2. **Kendali Sinkron & Jalankan dependensi** di halaman detail (AC-8, AC-9).
3. **README** lengkap + badge npm/CI.
4. **Merge ke `main`** + sinkronisasi `feat/v0.1`.
5. **Perbaikan bug publish**: `bin` ditulis `./dist/cli.js` sehingga npm membuangnya
   saat publish (perintah `skill-manager` tidak akan ada). Sudah jadi `dist/cli.js`.
6. **Test versi**: 3 test menulis `"0.1.0"` hardcode, pecah saat versi naik. Sekarang membaca
   dari `package.json`.
7. **Rilis npm 0.1.1**.

## Jebakan yang sudah ditemukan (JANGAN diulang)

### Windows

- **Junction** dilaporkan `readdir withFileTypes` sebagai non-directory. Jangan pakai
  `dirent.isDirectory()` untuk scan Store.
- **Dangling link**: `lstat` OK, `stat` ENOENT. Jangan pakai `access` sebagai probe.
- **`execFile` melempar sinkron** `spawn EINVAL` untuk shim `.cmd`/`.bat` (CVE-2024-27980).
  Sudah ditangani: try/catch + `EINVAL -> process_failed`.
- **`npm publish` menolak `bin` dengan awalan `./`** — dibuang diam-diam, hanya muncul
  sebagai `npm warn`. Selalu jalankan `npm publish --dry-run` sebelum publish sungguhan.

### Lingkungan mesin ini

- `~/.npmrc` berisi `allow-scripts=9router` — **BENAR dan diperlukan**, jangan dihapus.
  Error `EALLOWSCRIPTS` berasal dari **env var** `npm_config_allow_scripts` yang diwarisi dari
  `npx dsh`, bukan dari file. Di PowerShell pengguna, `npm install` biasa berjalan normal.
- `C:\Users\thinkpad\node_modules\.bin` ada di **urutan 1 PATH**, folder global di urutan 22.
  Instalasi lokal yang nyasar di folder home akan **menutupi** instalasi global.
- Folder paket global bisa terkunci (`EPERM`) kalau ada proses `skill-manager` masih jalan.
  Shim lama tertinggal -> `EEXIST`. Obat: hentikan proses, hapus folder paket + 3 shim, pasang ulang.

### Alat

- Tool `read` kadang mengembalikan isi yang tidak cocok dengan disk untuk berkas tertentu.
  Untuk edit presisi, pakai `node:fs` `readFileSync`/`writeFileSync` sebagai sumber kebenaran.
- Terminal sering menampilkan karakter UTF-8 sebagai mojibake. **Verifikasi lewat byte**, jangan lewat tampilan konsol.

## Pekerjaan yang MASIH tersisa

### Menunggu keputusan manusia (jangan dikerjakan sendiri)

1. **Perilaku `adopt`** — implementasi sekarang **menyalin isi Store ke Library**, sedangkan
   spec 10.5 berbunyi "perbarui hash Library". Saya sengaja menyimpang karena kalau hanya hash
   yang diperbarui, Library mengaku versi baru padahal isinya versi lama. Butuh keputusan:
   pertahankan atau kembalikan. Test ada di `src/maintenance/sync.test.ts`.

2. **Hapus `0.0.0-stage` dari npm** — token pengguna tidak punya izin. Harus dari akun mereka:
   `npm unpublish @ghaniy_fadhil/skill-manager@0.0.0-stage --force`

### Perbaikan kode yang belum dikerjakan

Urut dari paling berdampak:

1. **[BERAT] Duplikasi scaffolding** — `install.ts`/`uninstall.ts`/`sync.ts` menduplikasi
   plan->execute->persist (~230 baris): `fromFs`, `toTargetError`, `installationKey` (3 salinan);
   `ensureStoreDirectory`, `populateFrom`, `resolvePlanEntry`, `assertSharedAcknowledged` (2 salinan).
2. **[SEDANG] Test helper di dalam `src/`** — `src/maintenance/testing.ts` dan
   `src/server/routes/fixture.ts` (~320 baris) seharusnya di `test/support/` (belum ada).
3. **[SEDANG] `src/fs/process-node.test.ts` menjalankan proses anak sungguhan** dengan assert
   waktu. Kontrak 9 bilang unit test harus bebas disk. Pindahkan ke `test/integration/`.
4. **[RINGAN] Nama fixture** `test/fixtures/tipe{A..E}-*` vs kontrak 9 yang menulis
   `{a-markdown,b-npm,c-uv}`.
5. **[RINGAN] `function ok()` diduplikasi 18x** di banyak file test.
6. **[RINGAN] `targets.ts:129`** re-export berlebih.

## Risiko v0.1 yang sudah diterima

- Guard TOCTOU (cek-lalu-tulis tidak atomik).
- Isi Library yang berupa symlink disalin sebagai berkas biasa; hash bisa berbeda.
- Tidak ada migrasi state untuk `schemaVersion > 1` (dikarantina).
- `MemoryFileSystem` case-sensitive, sedangkan Windows tidak.
- Materialisasi symlink tidak kompatibel dengan hash.
- Restore yang gagal rollback meninggalkan target tidak ada tapi backup ada (prefix `TEMP_PREFIX`;
  `doctor` melaporkan, `restore` memulihkan).
- **`state.json` korup tidak dibangun ulang otomatis.** Berkas lama di-rename jadi
  `state.json.corrupt`, indeks diganti kosong. Folder `library/` tetap utuh di disk tapi tidak
  bisa dipakai lagi — **belum ada perintah rebuild**. Sudah didokumentasikan di README.
- `DELETE /api/installations` dengan `force: true` tidak butuh negosiasi server-side (hanya UI
  yang menjaga).

## Konvensi kerja

- **Gate per perubahan**: `pnpm run ci` hijau -> commit -> push -> CI GitHub hijau -> review.
- Commit message: conventional commit, **bahasa Indonesia**, deskriptif.
- Jangan edit `spec.md`, `docs/adr/**`, `GLOSSARY.md` tanpa keputusan eksplisit.
- `.scratch/skill-manager/contract.md` adalah kontrak implementasi yang **mengikat**.
- Verifikasi perilaku dengan **menjalankan sungguhan**, bukan hanya test. Beberapa bug terbesar sesi
  ini (bin publish, crash `provenance`, commit masuk branch salah) hanya ketahuan saat benar-benar
  dijalankan.

## Dokumentasi rujukan

| Berkas | Isi |
|---|---|
| `README.md` | Dokumentasi pengguna (cara pasang, perintah, batasan) |
| `GLOSSARY.md` | Istilah domain (Skill, Library, Store, Harness, Scope, Target, Installation) |
| `docs/adr/` | Keputusan arsitektur (D1-D15) |
| `.scratch/skill-manager/contract.md` | Kontrak implementasi (mengikat) |
| `.scratch/skill-manager/` | Spec, ticket, catatan |

## Cara cepat memulai sesi berikutnya

```bash
cd C:\Users\thinkpad\Desktop\allMaProject\skillManager
git status && git log --oneline -3
pnpm run ci                                   # pastikan baseline hijau dulu
npm view @ghaniy_fadhil/skill-manager version # cek versi terbit
```

Kalau mau menaikkan versi: ubah `package.json`, jalankan `pnpm run ci`, lalu
`npm publish --access public` (butuh 2FA atau token dengan bypass 2FA).
