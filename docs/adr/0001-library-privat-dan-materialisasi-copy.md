# Library privat, materialisasi dengan salinan

Skill disimpan di Library privat milik aplikasi (XDG data dir / `%LOCALAPPDATA%`), bukan di `~/.agents/skills`, karena 12 harness membaca folder itu dan tool lain juga menulis ke sana — memakai folder bersama akan menghapus isolasi per-harness yang menjadi inti produk. Setiap Target menerima salinan fisik, bukan tautan, sehingga menghapus atau memindahkan Library tidak pernah meninggalkan tautan menggantung yang tampak "ada" bagi `lstat` tetapi tidak terbaca oleh harness; tautan tetap tersedia sebagai opsi lanjutan khusus Claude Code, Codex, dan Roo, satu-satunya harness yang terdokumentasi mengikuti tautan.

Konsekuensi: dibutuhkan operasi Sinkron dan deteksi drift (hash isi berbeda antara Library dan Store), serta ruang disk berlipat sejumlah Target.
