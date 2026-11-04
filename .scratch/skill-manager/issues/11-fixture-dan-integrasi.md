# 11 — Fixture skill dan uji integrasi lintas OS

Status: ready-for-agent

## Context

Kriteria penerimaan harus bisa dijalankan ulang, bukan diperiksa manual sekali.

## Scope

- Fixture tipe A (markdown murni + references), B (`scripts/` + `package.json`), C (`requirements.txt` + aset biner kecil).
- Satu skill diimpor lewat dua metode berbeda untuk menguji penolakan tabrakan nama.
- Uji integrasi memakai direktori Store sementara yang disuntikkan lewat `FileSystem`, bukan home directory asli.
- Matriks uji jalan di Windows dan Linux.

## Acceptance

- AC-3
- AC-4
- AC-5
- AC-6
- AC-7
- AC-8
- AC-9

## Comments
