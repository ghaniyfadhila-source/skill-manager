# 03 — Manifest adapter, deteksi, dan Recheck

Status: ready-for-agent

## Context

Adapter adalah data, bukan kode. Empat adapter managed di v0.1: Claude Code, opencode, Antigravity, dan Store shared.

## Scope

- Loader manifest bawaan + manifest pengguna di `<dataRoot>/adapters/*.json` (override berdasarkan `id`).
- Validasi manifest: `verified.at` wajib untuk tier `managed`.
- Deteksi: cek path (expand `~`) dan binary pada PATH + direktori kandidat; verifikasi dengan `--version` dan timeout 5 detik.
- Simpan dan tampilkan alasan deteksi per harness.
- Endpoint/CLI `detect` dan `Recheck` tanpa restart.
- Adapter v0.1: `claude-code`, `opencode`, `antigravity` (store `~/.gemini/config/skills`), `shared` (`.agents/skills`, members: Codex, Gemini, Cursor, Copilot, Amp, Zed, Roo, Kilo, Factory, DSH).
- Harness lain berstatus `detected-only` dan tidak dapat dipilih sebagai Target.

## Acceptance

- AC-2
- AC-11 (data `connect.installUrl`)
- AC-12 (bagian pelaporan adapter)

## Notes

Adapter Codex belum boleh berstatus managed sampai path-nya terverifikasi (lihat issue 12).

## Comments
