# 04 — Impor skill dari folder lokal

Status: ready-for-agent

## Context

Metode impor pertama dan paling sering dipakai saat authoring.

## Scope

- Validasi `SKILL.md` ada dan frontmatter bisa diparse; `name` harus sama dengan nama folder.
- Batas aman: 10 MiB, 1000 file; tolak path yang keluar folder.
- Salin ke `library/<name>`; tolak tabrakan nama dengan pesan yang menyebut skill yang sudah ada.
- Catat provenance: sumber folder, waktu impor, hash, lisensi bila ada.
- Field frontmatter di luar 6 field resmi: diterima dengan peringatan, bukan penolakan.

## Acceptance

- AC-3 (metode folder)
- AC-7 (prasyarat)

## Comments
