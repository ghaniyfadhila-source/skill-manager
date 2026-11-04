# Satu paket npm, bukan monorepo

Aplikasi punya satu executable, satu UI, dan satu siklus rilis; memecahnya menjadi pnpm workspaces akan menambah versioning antar-paket tanpa satu pun konsumen eksternal yang membutuhkannya. Semua modul tinggal di `src/{core,adapters,fs,server,web,cli}` di dalam satu paket, dan adapter tetap berupa file data di dalam paket.

Konsekuensi: bila kelak ada konsumen kedua (mis. paket adapter publik atau CLI terpisah), pemecahan dilakukan setelah ada kebutuhan nyata — bukan sebelumnya.
