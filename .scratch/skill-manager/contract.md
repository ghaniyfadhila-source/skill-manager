# Kontrak Implementasi — Skill Manager v0.1

> Dokumen ini **mengikat** semua implementer ticket. Ia tidak menggantikan
> `spec.md` (perilaku) atau ADR (keputusan). Bila kontrak ini bertabrakan dengan
> spec, **spec menang** — berhenti dan laporkan, jangan memutuskan sendiri.

## 1. Identitas paket

| Field | Nilai |
|---|---|
| `name` | `@ghaniyfadhila-source/skill-manager` (scoped; bisa berubah sebelum publish) |
| `bin` | `skill-manager` → `./dist/cli.js` |
| `type` | `module` |
| `license` | `Apache-2.0` |
| `engines.node` | `>=22.20` |
| `packageManager` | `pnpm@12.8.1` |

## 2. Perintah (gate)

```
pnpm run build      # vite build (src/web) + tsup (cli, server)
pnpm run typecheck  # tsc --noEmit
pnpm run lint       # biome check .
pnpm run format     # biome check --write .
pnpm run test       # vitest run
pnpm run ci         # lint && typecheck && test && build   ← gate wajib
```

**Definition of Done setiap ticket: `pnpm run ci` hijau di worktree ticket.**

## 3. Struktur direktori

```
src/
  cli/          entry point (src/cli/index.ts → dist/cli.js)
  core/         domain murni; TIDAK boleh mengimpor node:fs
  fs/           antarmuka FileSystem + implementasi Node + memori
  adapters/     manifest JSON (satu file per harness) + loader + deteksi
  server/       Hono app + node:http; tidak memegang logika domain
  web/          React 19 + Tailwind; dibundel Vite ke dist/web
test/
  fixtures/     skill A, B, C
  integration/  uji lintas modul dengan FileSystem memori / temp dir
```

Aturan impor:

- `core` ← `fs` (antarmuka saja), `core` tidak boleh impor `server`, `cli`, `web`
- `adapters` boleh impor `core` + `fs`
- `server`/`cli` boleh impor semuanya, tidak sebaliknya
- `web` hanya bicara ke server lewat HTTP

## 4. Konvensi kode

- ESM, TypeScript `strict`, tanpa dependensi native.
- Tidak ada `any` (Biome akan menolak). Gunakan `unknown` + zod di batas sistem.
- Semua I/O di `core` lewat antarmuka `FileSystem` (didefinisikan ticket 02).
- Error domain: `SkillManagerError` dengan `{ code, message, details? }`, `code` stabil untuk CLI/HTTP.
- Path selalu di-`realpath` sebelum operasi tulis/hapus.
- Tidak ada eksekusi proses saat startup.

## 5. Data root

| OS | Lokasi |
|---|---|
| Windows | `%LOCALAPPDATA%\SkillManager` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/skillmanager` |

Isi: `library/`, `adapters/` (override pengguna), `deps/`, `state.json`.
Bisa dioverride lewat env `SKILL_MANAGER_DATA_ROOT` (wajib untuk test).

## 6. Server & autentikasi (ticket 01, dipakai semua)

- Bind `127.0.0.1`, port `0` (acak), baca ulang `server.address().port`.
- Token acak 32 byte hex per proses.
- `GET /auth?token=<token>` → set cookie `sm_session` (httpOnly, SameSite=Strict, Path=/) → `302` ke `/` tanpa token di URL.
- Semua route lain: tanpa cookie valid → `401` JSON `{ error: { code: "unauthorized" } }`.
- Header `Host` bukan loopback (`127.0.0.1[:port]`, `localhost[:port]`, `[::1][:port]`) → `403`. Host yang tidak bisa diparse (kosong/malformed) boleh dijawab `400` oleh adapter HTTP; itu tetap penolakan, bukan bypass.
- `GET /api/health` → `{ ok: true, version }`.
- Static UI disajikan dari `dist/web`; SPA fallback ke `index.html` **hanya untuk navigasi** (Accept memuat `text/html`, tanpa ekstensi file). Aset yang hilang dan path `/api/*` yang tidak dikenal → `404` JSON.
- Semua route mendaftarkan handler galat global (`app.onError`) yang mengembalikan `{ error: { code, message } }`, termasuk `404` (`app.notFound`). Tidak pernah membalas teks polos.

## 7. API JSON v1

Semua respons galat: `{ error: { code, message, details? } }` + status HTTP yang sesuai.
`409` dipakai untuk konflik yang butuh keputusan user.

| Method | Path | Body / Query | Respons |
|---|---|---|---|
| GET | `/api/health` | — | `{ ok, version }` |
| GET | `/api/harnesses` | — | `{ harnesses: HarnessInfo[] }` |
| POST | `/api/harnesses/recheck` | — | `{ harnesses }` |
| GET | `/api/skills` | — | `{ skills: SkillSummary[] }` |
| GET | `/api/skills/:name` | — | `{ skill: SkillDetail }` |
| POST | `/api/skills/inspect` | `{ type, path?\|url?, ref? }` | `{ stagingId, files, risky, totalBytes, license?, suggestedName, provenance }` |
| POST | `/api/skills/import` | `{ stagingId }` atau `{ type:"folder", path }` | `201 { skill }` · `409` nama bentrok |
| GET | `/api/installations` | — | `{ installations: InstallationView[] }` |
| POST | `/api/installations` | `{ skill, targets: string[], acknowledgeShared?: boolean }` | `{ results: TargetResult[] }` · `409` bila shared belum diakui |
| DELETE | `/api/installations` | `{ skill, targets, force?: boolean, acknowledgeShared?: boolean }` | `{ results: TargetResult[] }` · `409` bila drift atau shared belum diakui |
| POST | `/api/sync` | `{ skill, action: "restore"\|"adopt" }` | `{ skill }` |
| GET | `/api/doctor` | — | `{ missing, unmanaged, tempDirs, stale }` |
| POST | `/api/doctor/clean-temp` | — | `{ removed: string[] }` — hanya menghapus direktori berawalan `.skill-manager-tmp-` |
| POST | `/api/deps/plan` | `{ skill }` | `{ commands: DepCommand[] }` |
| POST | `/api/deps/run` | `{ skill, allowScripts?: boolean }` | `{ ok, output }` |
| GET | `/api/connect/:harnessId` | — | `{ url }` — **server tidak menjalankan apa pun** |

Tipe bersama didefinisikan di `src/core/types.ts` (ticket 02) dan diimpor semua pihak.

## 8. CLI (spec §11)

`skill-manager detect|add|list|install|uninstall|sync|doctor|serve` + `--json` di semua perintah.
CLI memanggil `core` langsung, **bukan** lewat HTTP. Exit code `1` untuk operasi yang ditolak.

## 8a. Packaging

- Adapter manifest (`src/adapters/*.json`) diimpor sebagai modul dan **dibundel** oleh tsup ke `dist`. Tidak boleh ada file runtime yang dibaca relatif terhadap cwd saat terpasang.
- `prepack` menjalankan `pnpm run build` agar paket yang dipublish tidak pernah berisi `dist` basi.
- `react`/`react-dom` ada di `devDependencies` (dibundel Vite), bukan `dependencies`.

## 9. Testing

- Unit: Vitest, `src/**/*.test.ts`, memakai `MemoryFileSystem` — tanpa disk dan tanpa jaringan.
- Integrasi: `test/integration/*.test.ts`, memakai direktori temp yang disuntikkan via `FileSystem`.
- Fixture: `test/fixtures/{a-markdown,b-npm,c-uv}/`.
- Tidak ada test yang menulis ke home directory asli.

## 10. Git

- Branch integrasi: `feat/v0.1`.
- Branch ticket: `ticket/NN-slug`, worktree di `C:\Users\thinkpad\.sm-worktrees\NN-slug`.
- Commit: Conventional Commits, bahasa Indonesia untuk deskripsi.
- Ticket **tidak boleh** mengubah `.scratch/skill-manager/spec.md`, `docs/adr/**`, `GLOSSARY.md`, atau dokumen ini.
