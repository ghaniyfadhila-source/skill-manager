# 09 — Dependensi skill (npm dan uv) dengan persetujuan

Status: ready-for-agent

## Context

Satu-satunya bagian yang mengeksekusi kode pihak ketiga, jadi seluruhnya opt-in.

## Scope

- Deteksi dari isi skill: `package.json` -> npm, `requirements.txt`/`pyproject.toml` -> uv; `metadata.requires` sebagai petunjuk tambahan.
- Tampilkan perintah persis sebelum eksekusi; tidak ada eksekusi tanpa konfirmasi.
- Instalasi terisolasi per skill di `<dataRoot>/deps/<skillId>`.
- Default `--ignore-scripts`; mengizinkan script memerlukan konfirmasi terpisah.
- Bila npm/uv tidak tersedia: berhenti dan beri tahu; app tidak pernah memasang package manager.

## Acceptance

- AC-9

## Comments
