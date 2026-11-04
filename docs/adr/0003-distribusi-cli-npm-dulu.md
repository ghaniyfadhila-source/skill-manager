# Distribusi awal sebagai paket npm dengan UI di browser lokal

Versi pertama dirilis sebagai paket npm yang menjalankan server lokal di `127.0.0.1` dan membuka UI di browser, bukan installer desktop. Alasannya: installer Windows tanpa tanda tangan diblokir Smart App Control di mesin bersih, sementara sertifikat komersial tidak terjangkau dan SignPath Foundation (gratis untuk OSS) baru berguna setelah ada CI dan rilis. Jalur ini juga langsung jalan di Windows dan Linux tanpa build per-platform.

Konsekuensi: produk tidak memiliki jendela sendiri pada rilis pertama; aplikasi desktop bertanda tangan (SignPath + GitHub Releases + winget) menjadi tahap berikutnya yang memakai inti yang sama.
