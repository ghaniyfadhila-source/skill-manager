---
name: tipeB-scripts
description: Skill dengan scripts/ dan package.json untuk menguji rencana dependensi npm.
license: MIT
---
# Tipe B — skrip dan npm

Fixture untuk matriks §16: dependencies dideteksi dari `package.json`, dan
aplikasi hanya menyusun perintah `npm install --ignore-scripts` — tidak pernah
menjalankannya tanpa konfirmasi.

## Isi

- `scripts/run.sh` — skrip contoh; TIDAK dijalankan oleh Skill Manager.
- `package.json` — dependensi npm minimal.
