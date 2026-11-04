# 07 — Cabut skill dari Target

Status: ready-for-agent

## Context

Operasi yang menggantikan ON/OFF: menghapus salinan, bukan menonaktifkan.

## Scope

- Hanya menghapus direktori yang tercatat sebagai Installation dan hash-nya masih sama.
- Bila hash berbeda: tolak otomatis, minta user memilih.
- Multi-Target, laporan per Target.
- Library tidak pernah disentuh; pemasangan ulang berjalan tanpa jaringan.

## Acceptance

- AC-7

## Comments
