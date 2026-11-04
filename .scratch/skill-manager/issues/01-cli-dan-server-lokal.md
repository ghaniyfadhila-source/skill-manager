# 01 — Scaffold paket CLI dan server lokal

Status: ready-for-agent

## Context

Fondasi yang harus ada sebelum apa pun bisa diuji: satu paket npm yang bisa dijalankan via npx, menyalakan server HTTP hanya di loopback, dan mengautentikasi setiap request.

## Scope

- Struktur paket ESM TypeScript Node >= 22.20; build dengan tsup (server/CLI) dan Vite (UI); tanpa dependensi native.
- HTTP dengan Hono di atas `node:http`; validasi body dengan zod.
- Lint/format Biome; test Vitest; CI GitHub Actions matrix windows/ubuntu pada Node 22 dan 24.
- Perintah `serve`: bind `127.0.0.1` pada port 0, baca ulang `address().port`, cetak URL.
- Token acak per proses; URL pembuka memuat token; server menukarnya jadi cookie httpOnly lalu redirect tanpa token.
- Tolak request dengan header `Host` yang bukan loopback atau tanpa token.
- Semua perintah mendukung `--json`; exit code non-nol saat operasi ditolak.
- Tidak ada operasi tulis apa pun yang berjalan saat startup.

## Acceptance

- AC-1
- AC-10
- AC-11 (sisi server: tombol Connect hanya mengembalikan URL)

## Comments
