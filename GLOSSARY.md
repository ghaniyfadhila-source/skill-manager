# Skill Manager

Alat lokal untuk mengatur skill AI di banyak harness pada satu mesin. Berjalan sebagai CLI dengan UI di browser lokal; tanpa akun, cloud, atau telemetri.

## Language

**Skill**:
Satu unit instruksi yang dikemas sebagai folder berisi `SKILL.md` beserta aset pendukungnya.
_Avoid_: plugin, package, extension

**Library**:
Kumpulan skill kanonik yang dimiliki aplikasi; satu-satunya sumber kebenaran isi sebuah skill.
_Avoid_: store, repo, registry, vault

**Store**:
Direktori di disk tempat sebuah Installation berada, dimiliki oleh satu atau beberapa harness.
_Avoid_: folder, destination, target

**Harness**:
Perangkat lunak yang menjalankan agent dan punya aturannya sendiri tentang artefak apa yang dibaca dan dari direktori mana.
_Avoid_: tool, IDE, app, agent

**Scope**:
Jangkauan berlakunya sebuah pemasangan: `global` (seluruh mesin) atau `project` (satu folder proyek).
_Avoid_: level, workspace, environment

**Target**:
Pasangan (harness, scope) yang dipilih user sebagai tujuan pemasangan; setiap Target memetakan ke tepat satu Store.
_Avoid_: agent, destination, endpoint

**Installation**:
Catatan bahwa sebuah skill dari Library dipasang pada sebuah Store.
_Avoid_: install, copy, deployment

**Materialization**:
Tindakan membuat isi sebuah skill hadir secara fisik di direktori sebuah Store.
_Avoid_: deploy, sync, push
