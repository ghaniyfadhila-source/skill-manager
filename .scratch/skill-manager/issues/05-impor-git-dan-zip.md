# 05 — Impor skill dari git dan zip

Status: ready-for-agent

## Context

Dua metode impor dari luar, keduanya memasukkan isi yang tidak dipercaya.

## Scope

- Git: clone dangkal ke direktori sementara, checkout ref, resolusi commit, temukan `SKILL.md` di root atau satu subdirektori; catat `url`, `ref`, `commit`.
- Zip: ekstrak ke direktori sementara, tolak entri absolut dan entri yang keluar folder tujuan; batas ukuran dan jumlah file berlaku juga di sini.
- Tampilkan pohon file dan penanda risiko sebelum konfirmasi: ada `scripts/`, binary, symlink keluar folder, ukuran total.
- Lisensi ditampilkan; tidak ada penimpaan skill lama.

## Acceptance

- AC-3 (metode git dan zip)

## Comments
