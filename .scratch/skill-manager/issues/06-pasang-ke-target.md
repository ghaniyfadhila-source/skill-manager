# 06 — Pasang skill ke Target (termasuk grup shared)

Status: ready-for-agent

## Context

Inti produk: satu skill ke beberapa Target, dengan isolasi bila harness punya Store eksklusif.

## Scope

- Resolusi Target -> Store; default opencode memakai Store eksklusifnya.
- Opsi per Installation untuk memakai grup shared (opencode kehilangan isolasi) dengan peringatan.
- Instalasi multi-Target; kegagalan satu Target tidak membatalkan yang lain; hasil dilaporkan per Target.
- Bila tujuan sudah ada: laporkan konflik, jangan menimpa.
- Setelah salin, hitung hash tujuan dan catat Installation (skillId, storeId, mode, installedHash).

## Acceptance

- AC-4
- AC-5
- AC-6

## Comments
