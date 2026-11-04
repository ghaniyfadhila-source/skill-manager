# 08 — Drift, Sinkron, dan doctor

Status: ready-for-agent

## Context

Tanpa deteksi drift, salinan yang berbeda diam-diam menjadi dua kebenaran.

## Scope

- Hitung status per Installation: `clean`, `modified`, `missing`, `unmanaged`.
- Sinkron: 'kembalikan dari Library' (dengan konfirmasi) atau 'adopsi perubahan' (perbarui hash Library). Tidak pernah otomatis.
- `doctor`: Installation dengan direktori hilang, direktori unmanaged di Store, sisa direktori `.skill-manager-tmp-*`.
- Tampilkan jumlah Target yang tertinggal dari Library.

## Acceptance

- AC-8
- AC-12

## Comments
