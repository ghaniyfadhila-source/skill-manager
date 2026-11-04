# React + Vite untuk UI lokal

UI hanya punya empat layar dan disajikan dari `127.0.0.1`, sehingga ukuran bundel tidak relevan; React dipilih karena ekosistem tabel, dialog, dan form membuat pekerjaan UI selesai jauh lebih cepat daripada menghemat beberapa puluh kilobyte. Vite dipakai karena sekaligus menyediakan test runner (Vitest) dan build statis yang disajikan server.

Konsekuensi: rilis memerlukan langkah bundling UI sebelum `npm publish`, dan UI tidak bisa dijalankan tanpa build.
