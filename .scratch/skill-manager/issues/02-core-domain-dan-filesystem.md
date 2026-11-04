# 02 — Core domain, seam FileSystem, dan hashing

Status: ready-for-agent

## Context

Agar seluruh logika bisa diuji tanpa menyentuh disk sungguhan, domain dipisah dari I/O lewat satu antarmuka.

## Scope

- Tipe domain: Skill, Library, Store, Target, Installation, drift status.
- Antarmuka `FileSystem` (read, write, copy, remove, realpath, stat, readdir) + implementasi memori untuk test + implementasi Node.
- `contentHash`: SHA-256 deterministik atas daftar path terurut, bit executable, dan hash tiap file; tidak memakai mtime.
- Operasi tulis atomik: salin ke `<store>/.skill-manager-tmp-*` lalu rename.
- Guard `realpath`: tolak operasi yang keluar dari Store yang diharapkan, dan jangan pernah hapus rekursif melewati tautan.

## Acceptance

- Fondasi untuk AC-4 sampai AC-12

## Comments
