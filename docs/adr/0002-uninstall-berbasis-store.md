# Uninstall berbasis Store, tanpa flag ON/OFF

Tidak ada keadaan aktif/nonaktif: sebuah skill terpasang pada sebuah Store atau tidak. Unit pemasangan adalah Store, bukan harness — untuk harness yang punya direktori eksklusif Target memetakan ke Store itu (isolasi penuh), sedangkan harness yang hanya membaca Store bersama (Codex, Amp sebagian) berbagi Store yang sama dan UI wajib menyebutkan harness lain yang ikut terdampak.

Konsekuensi: menjamin "skill ini tidak ada di Codex" hanya mungkin bila skill tidak dipasang ke Store bersama sama sekali; toggle native per harness (mis. `skillOverrides`) sengaja tidak dipakai karena menambah kelas bug konfigurasi yang sulit dijelaskan.
