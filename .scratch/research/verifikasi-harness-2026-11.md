# Verifikasi Path & Perilaku Harness — 2026-11-05

**Ticket:** 12 — verifikasi path dan perilaku harness yang belum pasti
**Tanggal verifikasi:** 2026-11-05 (Asia/Jakarta)
**Metode:** dokumen resmi vendor (utama) + kode sumber vendor (bila dokumentasi bisu) + probe filesystem/CLI lokal **read-only**. Tidak ada percobaan menulis, membuat tautan, atau menjalankan installer.
**Lingkungan probe:** Windows, `USERPROFILE=C:\Users\thinkpad`, `LOCALAPPDATA=C:\Users\thinkpad\AppData\Local`.

Legenda status: **terverifikasi** (sumber primer menyatakan eksplisit) · **tidak terverifikasi** (tidak ada sumber primer) · **bertentangan** (dua sumber primer berbeda, atau sumber primer berbeda dengan asumsi spec §5.1).

---

## Ringkasan

| Harness | Klaim yang diuji | Status | Tier yang disarankan |
|---|---|---|---|
| Codex | Path global `$HOME/.agents/skills`; symlink diikuti | terverifikasi | **managed** (lewat Store shared) |
| Antigravity | `~/.gemini/config/skills` (App/IDE/CLI) vs `~/.gemini/skills` (CLI saja) | terverifikasi | managed |
| opencode (Windows) | `%USERPROFILE%\.config\opencode\skills` | terverifikasi | managed |
| Claude Code | `~/.claude/skills`; symlink diikuti | terverifikasi | managed |
| Shared `.agents` | `~/.agents/skills` dibaca Codex/opencode/Goose/Crush | terverifikasi | managed |
| Hermes | Windows: `%LOCALAPPDATA%\hermes\skills`; symlink diikuti | terverifikasi (kode sumber) | detected-only (roadmap) |
| Goose | `~/.agents/skills` kanonik; symlink diikuti | terverifikasi (docs + kode) | detected-only (roadmap) |
| Crush | `%LOCALAPPDATA%\crush\skills`; symlink diikuti | terverifikasi (docs + kode) | detected-only (roadmap) |
| Devin | `~/.config/devin/skills` vs `%APPDATA%\devin\skills` | **bertentangan** | detected-only |

**Kesimpulan untuk ticket 03:** adapter Codex boleh naik ke `managed` dengan `verified.at = "2026-11-05"`; Codex tidak punya Store eksklusif — satu-satunya jalur pasang adalah Store shared `~/.agents/skills`. Path `~/.codex/skills` **tidak boleh** dipakai: tidak ada di dokumentasi resmi saat ini.

---

## Bukti lokal (read-only, 2026-11-05)

Perintah: `Get-ChildItem`, `Get-Command`, `opencode --version`, `opencode debug paths`, `agy --version`, `hermes --version`, `hermes skills list`.

| Path | Isi | Catatan |
|---|---|---|
| `~/.gemini/config/skills` | 67 entri | Ada; Store global Antigravity |
| `~/.gemini/skills` | **tidak ada** | Konsisten dengan docs: hanya dibaca CLI |
| `~/.gemini/antigravity-cli` | 21 entri | Home CLI `agy` |
| `~/.config/opencode/skills` | 38 entri | opencode v2.0.24 |
| `~/.agents/skills` | 67 entri | Store shared |
| `~/.hermes/skills` | 27 entri (flat) | **bukan** home aktif Hermes saat ini |
| `%LOCALAPPDATA%\hermes\skills` | 19 entri (kategori) | Home aktif Hermes (lihat §4) |
| `~/.config/goose/skills` | 27 entri | Bukan path kanonik Goose di Windows |
| `~/.config/crush/skills` | 27 entri | Crush juga membaca ini (XDG) |
| `~/.config/devin/skills` | 27 entri | Devin tidak terpasang di mesin ini |
| `%APPDATA%\devin` | **tidak ada** | Bertentangan dengan docs CLI Devin |
| `%APPDATA%\opencode` | **tidak ada** | Menyangkal dugaan `%APPDATA%\opencode` |
| `%LOCALAPPDATA%\crush` | **tidak ada** | Crush tidak terpasang di mesin ini |
| `~/.claude/skills` | 28 entri | Claude Code |

CLI yang terdeteksi: `opencode` v2.0.24 (`C:\Users\thinkpad\AppData\Roaming\npm\opencode.ps1`), `agy` 1.5.0, `hermes` v0.21.5+4600.gca705db. `codex`, `crush`, `goose`, `devin`, `gemini`, `claude` tidak ada di PATH.

> Peringatan: 27 skill yang identik di `.hermes`, `.config/goose`, `.config/crush`, `.config/devin` adalah **salinan** (semua `LinkType` kosong), bukan bukti bahwa harness tersebut membaca path itu. Keberadaan direktori ≠ path efektif.

---

## 1. OpenAI Codex CLI

Sumber: <https://learn.chatgpt.com/docs/build-skills> (versi markdown: <https://learn.chatgpt.com/docs/build-skills.md>). Dokumen lama `https://developers.openai.com/codex/skills` menjawab **308 Permanent Redirect** ke `https://learn.chatgpt.com/docs/build-skills` (diverifikasi dengan `curl -I`); targetnya HTTP 200 — jadi dokumen yang dulu blockers kini terbaca.

| Klaim | Bukti (URL/kutipan) | Tanggal verifikasi | Status | Dampak ke manifest |
|---|---|---|---|---|
| Path skill global user adalah `$HOME/.agents/skills` (Windows: `%USERPROFILE%\.agents\skills`), bukan `~/.codex/skills` | "Codex reads skills from repository, user, admin, and system locations"; tabel: `USER` → `$HOME/.agents/skills` | 2026-11-05 | terverifikasi | `stores` Codex **kosong**; target codex/global dipetakan ke Store shared `~/.agents/skills`. Jangan menulis `~/.codex/skills`. |
| Repo: `.agents/skills` dipindai di setiap direktori dari CWD sampai root repo | "For repositories, Codex scans `.agents/skills` in every directory from your current working directory up to the repository root." | 2026-11-05 | terverifikasi | Tidak relevan untuk v0.1 (scope global saja) |
| Admin: `/etc/codex/skills`; system: bundled (`skill-creator`, `skill-installer`) | Tabel baris `ADMIN` dan `SYSTEM` | 2026-11-05 | terverifikasi | Tidak dikelola v0.1 |
| Nama ganda tidak digabung | "If two skills share the same `name`, Codex doesn't merge them; both can appear in skill selectors." | 2026-11-05 | terverifikasi | Drift/nama ganda mungkin muncul; jangan asumsikan dedupe |
| Codex mengikuti symlink folder skill | "Codex supports symlinked skill folders and follows the symlink target when scanning these locations." | 2026-11-05 | terverifikasi | Mode tautan aman untuk Codex (tapi v0.1 default salinan) |
| Enable/disable per skill lewat `~/.codex/config.toml` `[[skills.config]]` (`name` atau `path`, `enabled`); entri terakhir menang | "Use `[[skills.config]]` entries in `~/.codex/config.toml`… When more than one entry matches a skill, the last matching entry wins." | 2026-11-05 | terverifikasi | Di luar v0.1 (tidak ada toggle); catat untuk roadmap |
| `~/.codex` tetap home konfigurasi (`config.toml`), terpisah dari Store skill | "Use `[[skills.config]]` entries in `~/.codex/config.toml`" | 2026-11-05 | terverifikasi | `detect.paths` Codex: `~/.codex` + `~/.agents`; `CODEX_HOME` tidak diuji hari ini |

**Catatan:** dokumentasi tidak menyebut `~/.codex/skills` sama sekali. Klaim blog bahwa Codex memakai `~/.codex/skills` tetap **tidak terverifikasi** dan tidak dipakai.

---

## 2. Google Antigravity

Sumber: <https://antigravity.google/docs/skills> (markdown: `.../docs/skills.md`) dan <https://antigravity.google/docs/customization-discovery>.

| Klaim | Bukti (URL/kutipan) | Tanggal verifikasi | Status | Dampak ke manifest |
|---|---|---|---|---|
| Store global App + CLI + IDE adalah `~/.gemini/config/skills/<skill>/` | Tabel "Antigravity App skill locations": `~/.gemini/config/skills/<skill-folder>/` → "Global (all workspaces)"; tabel CLI menyebut "(all workspaces, shared with the Antigravity App)" | 2026-11-05 | terverifikasi | `stores[0].path = "~/.gemini/config/skills"`, `exclusive: true` — **sesuai spec §5.1** |
| `~/.gemini/skills/` **hanya** dibaca Antigravity CLI, tidak oleh App | "The Antigravity CLI also loads skills from `~/.gemini/antigravity-cli/skills/` and `~/.gemini/skills/`, which the Antigravity App doesn't read." | 2026-11-05 | terverifikasi | Jangan jadikan Store; skill yang hanya ditulis ke sini tidak terlihat di App |
| IDE mendukung legacy `~/.gemini/antigravity/skills/` | Tabel "Antigravity IDE skill locations": "legacy `~/.gemini/antigravity/skills/` is also supported" | 2026-11-05 | terverifikasi | Tidak dipakai (legacy) |
| Workspace: `<workspace-root>/.agents/skills/` + setiap parent sampai root repo; `.agent/skills` masih kompatibel | "Antigravity defaults to `.agents/skills`, but still maintains backward compatibility for `.agent/skills`." | 2026-11-05 | terverifikasi | Antigravity **tidak** membaca `~/.agents/skills` (global); `readsShared: false` untuk Store shared global |
| Precedence nama sama (App): personal-in-repo > workspace/manifest > personal `~/.gemini/config` > built-in; CLI: `~/.gemini/antigravity-cli/skills` + `~/.gemini/skills` mengalahkan semuanya | "When two skills … have the same name, Antigravity keeps one of them, in this order of priority: 1… 2… 3… 4…"; "In the Antigravity CLI, skills in … take priority over all of these" | 2026-11-05 | terverifikasi | Install ke Store global tidak menimpa skill workspace; konflik nama di Store harus ditolak seperti spec §10.3 |
| Perilaku symlink | Tidak ditemukan pernyataan di `/docs/skills` maupun `/docs/customization-discovery` | 2026-11-05 | **tidak terverifikasi** | Default salinan; mode tautan tidak boleh ditawarkan untuk Antigravity |
| Windows | Docs memakai `~` tanpa tabel Windows; probe lokal: `%USERPROFILE%\.gemini\config\skills` ada (67 entri), `%USERPROFILE%\.gemini\skills` tidak ada. Tidak ada override env yang didokumentasikan | 2026-11-05 | terverifikasi (docs + probe lokal); override env tidak terverifikasi | `~/.gemini/config/skills` → `%USERPROFILE%\.gemini\config\skills` |

**Bukti lokal:** `~/.gemini/config/skills` ada (67), `~/.gemini/skills` **tidak ada**, `agy` 1.5.0 terpasang. Ini konsisten dengan docs (App memakai `config/skills`).

---

## 3. opencode (Windows)

Sumber: <https://opencode.ai/docs/skills/> (markdown: `/docs/skills.md`) dan probe runtime `opencode debug paths`.

| Klaim | Bukti (URL/kutipan) | Tanggal verifikasi | Status | Dampak ke manifest |
|---|---|---|---|---|
| Windows: config global efektif `%USERPROFILE%\.config\opencode` (bukan `%APPDATA%\opencode`) | Docs: "Global config: `~/.config/opencode/skills/<name>/SKILL.md`". Probe: `opencode debug paths` (v2.0.24, Windows) → `config  C:\Users\thinkpad\.config\opencode`; `XDG_CONFIG_HOME` kosong | 2026-11-05 | terverifikasi | `stores[0].path = "~/.config/opencode/skills"` — **sesuai spec §8**; `%APPDATA%\opencode` ditolak |
| Global roots: `~/.config/opencode/skills`, `~/.claude/skills`, `~/.agents/skills` | "Global definitions are also loaded from `~/.config/opencode/skills/*/SKILL.md`, `~/.claude/skills/*/SKILL.md`, and `~/.agents/skills/*/SKILL.md`." | 2026-11-05 | terverifikasi | `readsShared: true` |
| Project: `.opencode/skills`, `.claude/skills`, `.agents/skills`; walk-up sampai git worktree | "OpenCode walks up from your current working directory until it reaches the git worktree." | 2026-11-05 | terverifikasi | Tidak dipakai v0.1 (scope global) |
| Precedence nama sama | Docs hanya: "Ensure skill names are unique across all locations." Tidak ada aturan pemenang | 2026-11-05 | **tidak terverifikasi** | Konflik nama di Store harus ditolak (spec §10.3), jangan mengandalkan urutan |
| Perilaku symlink | Tidak disebut di `/docs/skills` | 2026-11-05 | **tidak terverifikasi** | Default salinan |
| Docs v2 | `https://opencode.ai/v2/docs/skills.md` → 404; halaman `/docs/skills` yang dilayani saat ini memuat satu kalimat "OpenCode 1…" | 2026-11-05 | catatan | Verifikasi ulang saat rilis; perilaku v2.0.24 cocok dengan path dokumen |

**Bukti lokal:** `opencode v2.0.24`; `~/.config/opencode/skills` 38 entri; `%APPDATA%\opencode` tidak ada. Dugaan `%APPDATA%\opencode` di riset sebelumnya **bertentangan** dengan probe runtime dan tidak dipakai.

---

## 4. Hermes (roadmap, prioritas rendah)

Sumber: kode sumber upstream <https://github.com/NousResearch/hermes-agent> (checkout lokal v0.21.5+4600.gca705db, commit `ca705dbf7ef86425b381b542712aff310f1ee52c`, 2026-09-29) + probe CLI lokal.

| Klaim | Bukti (URL/kutipan) | Tanggal verifikasi | Status | Dampak ke manifest |
|---|---|---|---|---|
| Windows: home Hermes = `%LOCALAPPDATA%\hermes`; skills = `%LOCALAPPDATA%\hermes\skills` | `hermes_constants.py` L51–58: `if sys.platform == "win32": base = Path(local_appdata) … return base / ("hermes" + suffix)`; L1195–1197: `get_skills_dir() -> get_hermes_home() / "skills"` (<https://github.com/NousResearch/hermes-agent/blob/ca705db/hermes_constants.py#L51-L58>) | 2026-11-05 | terverifikasi (kode) | Store Hermes (roadmap) = `%LOCALAPPDATA%\hermes\skills`; **bukan** `~/.hermes/skills` |
| `~/.hermes/skills` (27 entri, diukur di spec §2) bukan home aktif | `hermes skills list` hanya menemukan 2 skill lokal: `graphify` (ada di `%LOCALAPPDATA%\hermes\skills`, tidak ada di `~/.hermes`) dan `second-brain`; 27 skill di `~/.hermes` (brainstorming, diagnosing-superpowers, dll.) tidak muncul di daftar | 2026-11-05 | **bertentangan** dengan asumsi spec §5.1 | Jangan pakai `~/.hermes/skills` sebagai Store; deteksi harus memakai `HERMES_HOME`/`%LOCALAPPDATA%\hermes` |
| Hermes mengikuti symlink saat memindai skill | `agent/skill_utils.py` L790: `for root, dirs, files in os.walk(skills_dir_str, followlinks=True)` (<https://github.com/NousResearch/hermes-agent/blob/ca705db/agent/skill_utils.py#L781-L799>) | 2026-11-05 | terverifikasi (kode) | Tautan aman secara teknis; tetap salinan default |
| Precedence: lokal → `create_dir` → `external_dirs`; project dir yang di-trust mengalahkan skill profile/bundled bernama sama | `get_all_skills_dirs()` L418–426; komentar L429–433: "…they override same-named profile/bundled skills" | 2026-11-05 | terverifikasi (kode) | Roadmap: jangan pasang ke `external_dirs`; Store utama saja |
| Disable per skill ada di `config.yaml`: `skills.disabled` + `skills.platform_disabled` | `get_disabled_skill_names()` L298–310 | 2026-11-05 | terverifikasi (kode) | Di luar v0.1 |
| Env override home: `HERMES_HOME` (dan suffix `HERMES_DATA_DIR_SUFFIX`) | `get_hermes_home()` L111–118 | 2026-11-05 | terverifikasi (kode) | Deteksi harus menghormati `HERMES_HOME` |

---

## 5. Goose (roadmap, prioritas rendah)

Sumber: dokumentasi <https://github.com/aaif-goose/goose/blob/main/documentation/docs/guides/context-engineering/using-skills.md> + kode `crates/goose/src/skills/mod.rs` dan `crates/goose-agent/src/skills/discovery.rs` (main @ `bfe8ccd23de1d2c47a4cb2970d522f093ae7f2ba`, 2026-11-05).

| Klaim | Bukti (URL/kutipan) | Tanggal verifikasi | Status | Dampak ke manifest |
|---|---|---|---|---|
| Root global kanonik = `~/.agents/skills`; project = `.agents/skills`; plugin = `~/.agents/plugins/<plugin>/skills` | Docs "Skill Locations": "1. `~/.agents/skills/` — Global skills… 2. `.agents/skills/`… 3. `~/.agents/plugins/<plugin-name>/`" | 2026-11-05 | terverifikasi | Goose tidak butuh Store sendiri; cukup shared (roadmap) |
| Backward-compat: `.goose/skills`, `.claude/skills`, `~/.claude/skills`, dan "platform-specific config directories" | Kutipan docs + kode `all_skill_dirs_with_config()` menambah `Paths::config_dir()/skills`, `~/.claude/skills`, `~/.config/agents/skills` | 2026-11-05 | terverifikasi | `stores` Goose (roadmap) jangan mengarang path config |
| Precedence: project dulu, lalu global; nama sama → entri pertama menang (built-in di-skip bila nama sudah ada) | Kode: "Order matches discovery precedence: project dirs first, then global dirs."; `discover_skills_with_config` memakai `HashSet seen` | 2026-11-05 | terverifikasi (kode) | Roadmap: pasang ke shared agar terlihat semua member |
| Symlink diikuti, termasuk target di luar root | `crates/goose-agent/src/skills/discovery.rs` L226–227: "Traversal follows file and directory symlinks, including targets outside a root. Canonical directory identities prevent cycles." | 2026-11-05 | terverifikasi (kode) | Tautan aman secara teknis |
| `~/.config/goose/skills` adalah root baca di Windows | Tidak ada. `Paths::config_dir()` memakai crate `etcetera` (app strategy Block/goose); lokasi Windows-nya **tidak diuji**. `~/.config/goose/skills` adalah bentuk POSIX | 2026-11-05 | **tidak terverifikasi** (Windows) | Jangan pakai `~/.config/goose/skills` sebagai Store di Windows |

**Catatan:** direktori `~/.config/goose/skills` (27) di mesin ini adalah salinan, bukan bukti path efektif.

---

## 6. Crush (roadmap, prioritas rendah)

Sumber: README <https://github.com/charmbracelet/crush> (bagian "Agent Skills") + kode `internal/skills/skills.go` (main @ `50dba64b6817391d753725f8db542d7e14c29e71`, 2026-11-04).

| Klaim | Bukti (URL/kutipan) | Tanggal verifikasi | Status | Dampak ke manifest |
|---|---|---|---|---|
| Root global: `$CRUSH_SKILLS_DIR`, `$XDG_CONFIG_HOME/agents/skills`, `$XDG_CONFIG_HOME/crush/skills`, `~/.agents/skills`, `~/.claude/skills`; Windows juga `%LOCALAPPDATA%\agents\skills` dan `%LOCALAPPDATA%\crush\skills` | README: daftar "The global paths we looks for skills are…" dan "On Windows, we also look at…" | 2026-11-05 | terverifikasi | Store Crush (roadmap) = `%LOCALAPPDATA%\crush\skills`; `~/.config/crush/skills` juga valid (XDG) |
| Project: `.agents/skills`, `.crush/skills`, `.claude/skills`, `.cursor/skills`; plus `options.skills_paths` / `option skill-path` | README | 2026-11-05 | terverifikasi | Tidak dipakai v0.1 |
| Symlink diikuti (termasuk subdirektori yang di-taut) | `skills.go` L238–240: "We use fastwalk with Follow: true instead of filepath.WalkDir because WalkDir doesn't follow symlinked directories at any depth…" | 2026-11-05 | terverifikasi (kode) | Tautan aman secara teknis |
| Precedence nama sama | README hanya mendaftar urutan tanpa aturan pemenang; kode dedupe berdasarkan **path**, bukan nama | 2026-11-05 | **tidak terverifikasi** | Konflik nama dapat muncul ganda; jangan andalkan urutan |
| Disable per skill: `option disable-skill <name>` | README "Disabling Skills" | 2026-11-05 | terverifikasi | Di luar v0.1 |

---

## 7. Devin / Windsurf (roadmap, prioritas rendah)

Sumber: <https://docs.devin.ai/desktop/cascade/skills.md> (Devin Local/Desktop) dan <https://docs.devin.ai/cli/extensibility/skills/creating-skills.md> (Devin CLI).

| Klaim | Bukti (URL/kutipan) | Tanggal verifikasi | Status | Dampak ke manifest |
|---|---|---|---|---|
| Desktop: global `~/.config/devin/skills/<name>/`; juga membaca `~/.agents/skills/`; workspace `.devin/skills`, `.agents/skills`, legacy `.windsurf/skills` | Tabel "Skill scopes": Global → "`~/.config/devin/skills/<name>/` (`~/.agents/skills/` is also read)" | 2026-11-05 | terverifikasi (POSIX) | Roadmap: kandidat Store `~/.config/devin/skills` |
| CLI: Windows global `%APPDATA%\devin\skills\` | "Windows: `%APPDATA%\devin\skills\`"; catatan: "`%APPDATA%` typically resolves to `C:\Users\<YourUser>\AppData\Roaming`" | 2026-11-05 | terverifikasi untuk CLI | **tidak konsisten** dengan halaman Desktop |
| Kedua dokumen menunjuk path global yang sama | Desktop menulis `~/.config/devin/skills` (bentuk POSIX); CLI menulis `%APPDATA%\devin\skills`. Di mesin ini `%APPDATA%\devin` tidak ada, `~/.config/devin/skills` ada (27 salinan) | 2026-11-05 | **bertentangan** | Jangan jadikan managed; tier `detected-only` sampai diuji di mesin dengan Devin terpasang |
| Perilaku symlink | Tidak disebut di kedua halaman | 2026-11-05 | **tidak terverifikasi** | Salinan |
| Precedence nama sama | Tidak ada aturan; hanya daftar scope | 2026-11-05 | **tidak terverifikasi** | — |

---

## 8. Shared `.agents` (Store lintas harness)

| Klaim | Bukti (URL/kutipan) | Tanggal verifikasi | Status | Dampak ke manifest |
|---|---|---|---|---|
| `~/.agents/skills` adalah root baca resmi Codex | Codex docs tabel `USER`: `$HOME/.agents/skills` | 2026-11-05 | terverifikasi | Store shared valid |
| opencode membaca `~/.agents/skills` | opencode docs: "Global definitions are also loaded from … `~/.agents/skills/*/SKILL.md`" | 2026-11-05 | terverifikasi | Store shared valid |
| Goose membaca `~/.agents/skills` | Goose docs "Skill Locations" #1 | 2026-11-05 | terverifikasi | Store shared valid |
| Crush membaca `~/.agents/skills` | Crush README daftar global paths | 2026-11-05 | terverifikasi | Store shared valid |
| Antigravity **tidak** membaca `~/.agents/skills` (hanya `.agents/skills` workspace) | Antigravity docs: global App = `~/.gemini/config/skills`; `.agents/skills` disebut sebagai workspace + parent folder | 2026-11-05 | terverifikasi | `antigravity.readsShared = false`; memasang ke shared tidak membuat Antigravity melihatnya |
| Claude Code **tidak** membaca `~/.agents/skills` | Claude Code docs hanya mendaftar `~/.claude/skills`, project `.claude/skills`, enterprise, plugin | 2026-11-05 | terverifikasi | `claude-code.readsShared = false` |
| `~/.agents/skills` juga ditulis CLI `npx skills` (spec §17) | Tidak diuji ulang hari ini; `~/.agents/skills` berisi 67 entri | 2026-11-05 | tidak diuji ulang | Konflik tulis tetap dianggap normal |

---

## 9. Perilaku mengikuti tautan (symlink/junction) — di luar Claude Code/Codex/Roo

| Harness | Mengikuti tautan? | Bukti | Tindakan materialization |
|---|---|---|---|
| Claude Code | ya | Docs: "a `<skill-name>` entry … can be a symlink to a directory elsewhere on disk… loads the skill once" (<https://code.claude.com/docs/en/skills>) | Boleh tautan (opsi lanjutan) |
| Codex | ya | Codex docs (kutipan §1) | Boleh tautan (opsi lanjutan) |
| Roo Code | ya | Riset sebelumnya (docs Roo); **tidak diambil ulang hari ini** | Boleh tautan |
| Hermes | ya | `os.walk(..., followlinks=True)` | Salinan default |
| Goose | ya | Komentar kode discovery | Salinan default |
| Crush | ya | `fastwalk.Config{Follow: true}` | Salinan default |
| opencode | **tidak terverifikasi** | Docs bisu | **Salinan wajib** |
| Antigravity | **tidak terverifikasi** | Docs bisu | **Salinan wajib** |
| Devin | **tidak terverifikasi** | Docs bisu | **Salinan wajib** |
| Gemini CLI, Cursor, Copilot, Windsurf | **tidak terverifikasi** | Tidak ada pernyataan primer yang ditemukan | **Salinan wajib** |

**Konsekuensi:** ADR-0001 (tautan hanya untuk Claude Code, Codex, Roo) tetap valid. Temuan baru (Hermes/Goose/Crush mengikuti tautan) belum cukup untuk mengubah ADR karena ketiganya belum adapter v0.1; catat sebagai kandidat roadmap.

---

## 10. Manifest siap pakai

Catatan:
- `~` diekspansi ke `%USERPROFILE%` di Windows.
- Codex **tidak punya Store eksklusif**; `stores` sengaja kosong dan `readsShared: true`. Bila loader ticket 03 menolak array kosong, Codex harus dipetakan ke Store shared — jangan mengarang `~/.codex/skills`.
- Blok `shared` adalah deskriptor Store shared, bukan harness dengan installer sendiri.
- `verified.source` hanya satu URL; sumber pendukung ada di tabel atas.

### `src/adapters/claude-code.json`

```json
{
  "id": "claude-code",
  "name": "Claude Code",
  "tier": "managed",
  "detect": {
    "paths": ["~/.claude"],
    "binaries": ["claude"],
    "versionArgs": ["--version"]
  },
  "stores": [
    { "scope": "global", "path": "~/.claude/skills", "exclusive": true }
  ],
  "readsShared": false,
  "connect": {
    "installUrl": "https://code.claude.com/docs/en/setup",
    "docsUrl": "https://code.claude.com/docs/en/skills"
  },
  "verified": {
    "at": "2026-11-05",
    "source": "https://code.claude.com/docs/en/skills"
  }
}
```

### `src/adapters/opencode.json`

```json
{
  "id": "opencode",
  "name": "opencode",
  "tier": "managed",
  "detect": {
    "paths": ["~/.config/opencode"],
    "binaries": ["opencode"],
    "versionArgs": ["--version"]
  },
  "stores": [
    { "scope": "global", "path": "~/.config/opencode/skills", "exclusive": true }
  ],
  "readsShared": true,
  "connect": {
    "installUrl": "https://opencode.ai/docs",
    "docsUrl": "https://opencode.ai/docs/skills/"
  },
  "verified": {
    "at": "2026-11-05",
    "source": "https://opencode.ai/docs/skills/"
  }
}
```

### `src/adapters/antigravity.json`

```json
{
  "id": "antigravity",
  "name": "Google Antigravity",
  "tier": "managed",
  "detect": {
    "paths": ["~/.gemini/config"],
    "binaries": ["agy"],
    "versionArgs": ["--version"]
  },
  "stores": [
    { "scope": "global", "path": "~/.gemini/config/skills", "exclusive": true }
  ],
  "readsShared": false,
  "connect": {
    "installUrl": "https://antigravity.google/download",
    "docsUrl": "https://antigravity.google/docs/skills"
  },
  "verified": {
    "at": "2026-11-05",
    "source": "https://antigravity.google/docs/skills"
  }
}
```

### `src/adapters/shared.json`

```json
{
  "id": "shared",
  "name": "Shared (.agents)",
  "tier": "managed",
  "detect": {
    "paths": ["~/.agents"],
    "binaries": [],
    "versionArgs": []
  },
  "stores": [
    { "scope": "global", "path": "~/.agents/skills", "exclusive": false }
  ],
  "readsShared": true,
  "connect": {
    "installUrl": "https://agentskills.io",
    "docsUrl": "https://agentskills.io/specification"
  },
  "verified": {
    "at": "2026-11-05",
    "source": "https://learn.chatgpt.com/docs/build-skills"
  }
}
```

### `src/adapters/codex.json`

```json
{
  "id": "codex",
  "name": "OpenAI Codex CLI",
  "tier": "managed",
  "detect": {
    "paths": ["~/.codex", "~/.agents/skills"],
    "binaries": ["codex"],
    "versionArgs": ["--version"]
  },
  "stores": [],
  "readsShared": true,
  "connect": {
    "installUrl": "https://learn.chatgpt.com/docs/codex/cli",
    "docsUrl": "https://learn.chatgpt.com/docs/build-skills"
  },
  "verified": {
    "at": "2026-11-05",
    "source": "https://learn.chatgpt.com/docs/build-skills"
  }
}
```

---

## 11. Hal yang tetap tidak terverifikasi (jangan diisi asumsi)

1. Perilaku symlink opencode, Antigravity, Devin, Gemini CLI, Cursor, Copilot, Windsurf.
2. Precedence nama sama untuk opencode, Crush, dan Devin. (Antigravity sudah punya aturan eksplisit — lihat §2.)
3. Lokasi `config_dir` Goose di Windows (hanya relevan bila memasang ke Store Goose; kanoniknya tetap `~/.agents/skills`).
4. Path global efektif Devin di Windows: dokumen Desktop dan CLI saling bertentangan.
5. `~/.codex/skills`: tidak ada di dokumentasi resmi; dianggap legacy/tidak valid sampai ada sumber primer.
