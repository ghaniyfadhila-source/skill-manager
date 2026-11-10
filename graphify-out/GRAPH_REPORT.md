# Graph Report - skillManager  (2026-11-10)

## Corpus Check
- 181 files · ~102,899 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: (none) 3, .css 1)

## Summary
- 1505 nodes · 4067 edges · 105 communities (85 shown, 20 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 191 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a1925c97`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- ref_node_path
- harness.ts
- fixture.ts
- commands.ts
- Desktop-stack constraints for a local-first "skill manager"
- model.ts
- adapters/index.ts
- App.tsx
- staging.ts
- web/types.ts
- Skill Manager — Spec v0.1
- app.ts
- import-folder.ts
- MemoryFileSystem
- biome.json
- core/types.ts
- FsResult
- errors.ts
- maintenance/sync.ts
- fs/types.ts
- confirm.ts
- loadAdapters
- Harness Skill Paths — Where AI coding agents store skills, and how enable/disable works
- Verifikasi Path & Perilaku Harness — 2026-11-05
- FileSystem
- SkillManagerError
- install.ts
- import-zip.ts
- api.ts
- views.test.tsx
- .mkdir
- compilerOptions
- state.ts
- import-git.ts
- package.json
- import-zip.test.ts
- detect.test.ts
- inspect.ts
- devDependencies
- catalog.tsx
- targets.test.ts
- install.test.ts
- catalog.ts
- process-node.ts
- Handoff — Skill Manager v0.1 (sesi 2)
- guard.ts
- frontmatter.ts
- Skill Manager
- tipeB-scripts/package.json
- paths.ts
- FakeProcessRunner
- HANDOFF — Skill Manager
- atomic.ts
- uninstall.test.ts
- Agent Skills ecosystem, install tooling, registries, and "skill manager" prior art
- walk.ts
- import-git.test.ts
- harnesses.ts
- state.test.ts
- scripts
- 2. Distribution / install tooling
- deps.ts
- process-fake.ts
- 12 — Verifikasi path dan perilaku harness yang belum pasti
- skill-source.ts
- Domain Docs
- Issue tracker: Local Markdown
- Rancangan fitur Katalog (catalog)
- 04 — Impor skill dari folder lokal
- 05 — Impor skill dari git dan zip
- 06 — Pasang skill ke Target (termasuk grup shared)
- 07 — Cabut skill dari Target
- 09 — Dependensi skill (npm dan uv) dengan persetujuan
- 10 — UI: Skills, Matrix, Harnesses, Doctor
- 11 — Fixture skill dan uji integrasi lintas OS
- atomic.test.ts
- Agent skills
- dependencies
- 1. The Agent Skills / SKILL.md format
- vite.config.ts
- Jebakan yang sudah ditemukan (JANGAN diulang)
- Skill Manager
- repository
- 9. Roo Code and Kilo Code (same lineage, different paths, same spec)
- Apa yang dibangun
- Pekerjaan yang MASIH tersisa
- Tipe A — Panduan Reference
- Tipe A — markdown murni
- Tipe B — skrip dan npm
- Tipe C — Python dan aset biner
- 0001-library-privat-dan-materialisasi-copy.md
- 0002-uninstall-berbasis-store.md
- 0003-distribusi-cli-npm-dulu.md
- 0004-satu-paket-npm.md
- 0005-react-vite-untuk-ui.md
- triage-labels.md
- bin
- bugs
- engines
- publishConfig
- tsup
- checklist.md
- run.sh
- tipeD-rusak/README.md
- tipeE-frontmatter-rusak/SKILL.md

## God Nodes (most connected - your core abstractions)
1. `FsResult` - 81 edges
2. `SkillManagerError` - 80 edges
3. `FileSystem` - 69 edges
4. `MemoryFileSystem` - 66 edges
5. `fsOk()` - 60 edges
6. `vitest` - 54 edges
7. `loadState()` - 43 edges
8. `fsErr()` - 41 edges
9. `contentHash()` - 39 edges
10. `Adapter` - 33 edges

## Surprising Connections (you probably didn't know these)
- `1.1 Who publishes it` --references--> `main()`  [INFERRED]
  .scratch/research/skills-ecosystem-and-prior-art.md → src/cli/index.ts
- `Risiko v0.1 yang sudah diterima` --references--> `MemoryFileSystem`  [INFERRED]
  .scratch/skill-manager/handoff-sesi-2.md → src/fs/memory.ts
- `Pengembangan` --references--> `FileSystem`  [INFERRED]
  README.md → src/fs/types.ts
- `Struktur kode` --references--> `FileSystem`  [INFERRED]
  .scratch/skill-manager/handoff-sesi-2.md → src/fs/types.ts
- `Scope` --references--> `FileSystem`  [INFERRED]
  .scratch/skill-manager/issues/11-fixture-dan-integrasi.md → src/fs/types.ts

## Import Cycles
- None detected.

## Communities (105 total, 20 thin omitted)

### Community 0 - "ref_node_path"
Cohesion: 0.05
Nodes (64): vitest, 4. Model domain (ringkas), 02 — Core domain, seam FileSystem, dan hashing, Acceptance, Comments, Context, Scope, 08 — Drift, Sinkron, dan doctor (+56 more)

### Community 1 - "harness.ts"
Cohesion: 0.05
Nodes (50): 10. Git, 1. Identitas paket, 2. Perintah (gate), 3. Struktur direktori, 4. Konvensi kode, 5. Data root, 6. Server & autentikasi (ticket 01, dipakai semua), 7. API JSON v1 (+42 more)

### Community 2 - "fixture.ts"
Cohesion: 0.06
Nodes (52): Task C — Route `GET /api/catalog`, fakeFetch(), starsFor(), ErrorBody, DepCommandView, ErrorBody, npmSkill(), RunResultView (+44 more)

### Community 3 - "commands.ts"
Cohesion: 0.06
Nodes (38): @hono/node-server, 01 — Scaffold paket CLI dan server lokal, Acceptance, Comments, Context, Scope, adaptersOf(), addCommand() (+30 more)

### Community 4 - "Desktop-stack constraints for a local-first "skill manager""
Cohesion: 0.05
Nodes (39): 0. The 12 facts that actually shape the design, 10. What I could NOT confirm, 11. Source index, 1.1 What each thing is, 1.2 Privileges and Developer Mode, 1.3 MEASURED: non-admin, Developer Mode ON, 1.4 MEASURED: target deleted, moved, re-created, 1.5 What a failed symlink actually raises (+31 more)

### Community 5 - "model.ts"
Cohesion: 0.14
Nodes (28): belongsTo(), cellFor(), CellState, CellStatus, driftIsProblem(), driftLabel(), installationFor(), MatrixColumn (+20 more)

### Community 6 - "adapters/index.ts"
Cohesion: 0.10
Nodes (20): BUNDLED_ADAPTERS, RecheckResult, AdapterCatalog, AdapterProblem, describe(), formatIssues(), platformPath(), Adapter (+12 more)

### Community 7 - "App.tsx"
Cohesion: 0.13
Nodes (24): react, react-dom, api, App(), describeResults(), NAV, ConfirmPrompt, ConfirmController (+16 more)

### Community 8 - "staging.ts"
Cohesion: 0.15
Nodes (25): Bagian, Task A — Impor subfolder dari monorepo, assertStagingId(), cleanStaleStaging(), discardStaged(), finalize(), importStaged(), newId() (+17 more)

### Community 9 - "web/types.ts"
Cohesion: 0.09
Nodes (13): 16. Zed, 2.1 vercel-labs `skills` CLI (`npx skills`, skills.sh), Api, DepCommand, DepsRunResult, HarnessCapability, HarnessTarget, InspectRisk (+5 more)

### Community 10 - "Skill Manager — Spec v0.1"
Cohesion: 0.07
Nodes (27): 10.1 Deteksi, 10.2 Impor, 10.3 Pasang, 10.4 Cabut, 10.6 Dependensi, 10. Alur utama, 11. Permukaan CLI, 12. UI (+19 more)

### Community 11 - "app.ts"
Cohesion: 0.12
Nodes (23): checkHost(), createApp(), defaultServerDeps(), ErrorBody, ErrorStatus, handleAppError(), HostCheck, isSpaNavigation() (+15 more)

### Community 12 - "import-folder.ts"
Cohesion: 0.15
Nodes (24): SourceInfo, WalkEntry, assertNoConflict(), collectWarnings(), conflictError(), copyError(), copyIntoLibrary(), createSkillId() (+16 more)

### Community 13 - "MemoryFileSystem"
Cohesion: 0.19
Nodes (4): MemoryFileSystem, FileStat, fsErr(), CopyDeniedFs

### Community 14 - "biome.json"
Cohesion: 0.08
Nodes (24): files, includes, formatter, arrowParentheses, enabled, indentStyle, indentWidth, lineEnding (+16 more)

### Community 15 - "core/types.ts"
Cohesion: 0.12
Nodes (23): ConnectInfo, Installation, Library, MaterializationMode, ProjectRecord, Settings, SourceType, Store (+15 more)

### Community 16 - "FsResult"
Cohesion: 0.29
Nodes (6): nodeErrno(), NodeFileSystem, toFsError(), fsOk(), FsResult, treeSnapshot()

### Community 17 - "errors.ts"
Cohesion: 0.13
Nodes (16): SkillManagerErrorInit, DepKind, assertDependencyTools(), checkDependencyTool(), CheckToolOptions, ToolAvailability, DATA_ROOT, DEPS_DIR (+8 more)

### Community 18 - "maintenance/sync.ts"
Cohesion: 0.20
Nodes (19): libraryRoot(), stageManifests(), writeDirectoryAtomic(), missingLibraryEntries(), adoptOne(), ensureStoreDirectory(), fromFs(), installationKey() (+11 more)

### Community 19 - "fs/types.ts"
Cohesion: 0.16
Nodes (18): entryKind(), MemoryNode, makeFs(), ok(), ROOT, seedFile(), describe(), entryKindOf() (+10 more)

### Community 20 - "confirm.ts"
Cohesion: 0.16
Nodes (19): ApiError, isApiError(), ErrorInfo, Ask, confirmAndRun(), ConfirmationAction, ConfirmOptions, DriftImpact (+11 more)

### Community 21 - "loadAdapters"
Cohesion: 0.18
Nodes (17): hono, zod, loadAdapters(), AppOptions, registerConnectRoutes(), describeIssues(), ErrorBody, fsFailure() (+9 more)

### Community 22 - "Harness Skill Paths — Where AI coding agents store skills, and how enable/disable works"
Cohesion: 0.10
Nodes (20): 0. The shared spec everyone is converging on, 10. GitHub Copilot (cloud agent, CLI, VS Code agent mode), 11. Amp (Sourcegraph), 12. Factory Droid, 13. Kiro (AWS), 14. Aider, 15. Continue, 17. Crush (Charm) (+12 more)

### Community 23 - "Verifikasi Path & Perilaku Harness — 2026-11-05"
Cohesion: 0.10
Nodes (19): 10. Manifest siap pakai, 11. Hal yang tetap tidak terverifikasi (jangan diisi asumsi), 1. OpenAI Codex CLI, 2. Google Antigravity, 3. opencode (Windows), 4. Hermes (roadmap, prioritas rendah), 5. Goose (roadmap, prioritas rendah), 6. Crush (roadmap, prioritas rendah) (+11 more)

### Community 24 - "FileSystem"
Cohesion: 0.17
Nodes (17): binaryNames(), candidateDirs(), createContext(), DetectContext, detectHarnesses(), detectOne(), DetectOptions, findBinary() (+9 more)

### Community 25 - "SkillManagerError"
Cohesion: 0.21
Nodes (16): SkillManagerError, findLibrarySkill(), resolveLibrarySkill(), loadState(), wrap(), asDomainError(), flatten(), importSchema (+8 more)

### Community 26 - "install.ts"
Cohesion: 0.17
Nodes (18): assertSharedAcknowledged(), conflictError(), ConflictOwner, ensureStoreDirectory(), findOwner(), fromFs(), installationKey(), installOne() (+10 more)

### Community 27 - "import-zip.ts"
Cohesion: 0.29
Nodes (19): assertLimits(), assertSingleDisk(), decodeEntryName(), entryData(), extractError(), extractZipTo(), findEndOfCentralDirectory(), ImportZipOptions (+11 more)

### Community 28 - "api.ts"
Cohesion: 0.15
Nodes (15): apiErrorFromBody(), ApiErrorInit, createApi(), Fetcher, isRecord(), listAt(), normalizeCapability(), normalizeCatalogItem() (+7 more)

### Community 29 - "views.test.tsx"
Cohesion: 0.19
Nodes (13): uninstallPrompt(), DoctorReport, DriftEntry, Chip(), ConfirmDialog(), EmptyState(), handleDialogKey(), DoctorView() (+5 more)

### Community 30 - ".mkdir"
Cohesion: 0.16
Nodes (14): seedFile(), DATA_ROOT, ok(), seedFile(), seed(), toBytes(), ok(), OUTSIDE (+6 more)

### Community 31 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, forceConsistentCasingInFileNames, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+10 more)

### Community 32 - "state.ts"
Cohesion: 0.14
Nodes (14): contentHashSchema, CORRUPT_STATE_FILE_NAME, emptyState(), formatIssues(), installationSchema, projectSchema, recovered(), skillSchema (+6 more)

### Community 33 - "import-git.ts"
Cohesion: 0.21
Nodes (17): ALLOWED_PROTOCOLS, checkoutCommit(), cloneArgs(), ClonedGitSource, cloneGitTo(), GIT_BINARY, GIT_CLONE_TIMEOUT_MS, GIT_COMMAND_TIMEOUT_MS (+9 more)

### Community 34 - "package.json"
Cohesion: 0.12
Nodes (16): description, files, homepage, keywords, license, name, packageManager, type (+8 more)

### Community 35 - "import-zip.test.ts"
Cohesion: 0.14
Nodes (9): DATA_ROOT, ok(), RecordingFileSystem, ROOT, seedFile(), TEMP_ROOT, UNZIP, ZIP_PATH (+1 more)

### Community 36 - "detect.test.ts"
Cohesion: 0.13
Nodes (13): 03 — Manifest adapter, deteksi, dan Recheck, Acceptance, Comments, Context, Notes, Scope, BIN_DIR, bundled() (+5 more)

### Community 37 - "inspect.ts"
Cohesion: 0.20
Nodes (13): BINARY_EXTENSIONS, buildTree(), detectLicense(), escapesRoot(), inspectError(), InspectErrorCode, InspectNode, InspectResult (+5 more)

### Community 38 - "devDependencies"
Cohesion: 0.14
Nodes (14): devDependencies, @biomejs/biome, react, react-dom, tailwindcss, @tailwindcss/vite, tsup, @types/node (+6 more)

### Community 39 - "catalog.tsx"
Cohesion: 0.19
Nodes (11): Plan — Katalog skill GitHub (fitur catalog), Review focus, Task B — Modul katalog (seed + metadata hidup), Task D — UI Katalog + alur Pasang, Task E — Gate + verifikasi nyata, targetColumns(), CatalogItem, CatalogCard() (+3 more)

### Community 40 - "targets.test.ts"
Cohesion: 0.26
Nodes (11): adapterCapability(), listStores(), parseTargetId(), resolveTarget(), sharedStore(), bundled(), DATA_ROOT, HOME (+3 more)

### Community 41 - "install.test.ts"
Cohesion: 0.19
Nodes (10): Skill, STATE_SCHEMA_VERSION, InstallContext, DATA_ROOT, Fixture, HOME, LIBRARY, mkdirp() (+2 more)

### Community 42 - "catalog.ts"
Cohesion: 0.27
Nodes (8): CatalogFetcher, CatalogItem, enrichCatalog(), repoStars(), SEED, CATALOG_SEED, CatalogSeed, registerCatalogRoutes()

### Community 43 - "process-node.ts"
Cohesion: 0.24
Nodes (10): createNodeProcessRunner(), describe(), errnoOf(), ExecFailure, NodeProcessRunner, PROCESS_ERROR_CODES, runner, toProcessError() (+2 more)

### Community 44 - "Handoff — Skill Manager v0.1 (sesi 2)"
Cohesion: 0.18
Nodes (11): 0. Instruksi untuk agent berikutnya, Cara cepat memulai sesi berikutnya, Dokumentasi rujukan, Gate, Handoff — Skill Manager v0.1 (sesi 2), Identitas proyek, Konvensi kerja, Risiko v0.1 yang sudah diterima (+3 more)

### Community 45 - "guard.ts"
Cohesion: 0.30
Nodes (10): GuardedPath, guardStorePath(), GuardStorePathOptions, isPathInside(), isSamePath(), removeWithinStore(), makeStore(), ok() (+2 more)

### Community 46 - "frontmatter.ts"
Cohesion: 0.24
Nodes (8): Frontmatter, FRONTMATTER_INVALID_CODE, FrontmatterValue, invalid(), OFFICIAL_FRONTMATTER_FIELDS, OfficialFrontmatterField, parseFrontmatter(), parseScalar()

### Community 47 - "Skill Manager"
Cohesion: 0.18
Nodes (10): Antarmuka web, Batasan v0.1, Di mana datanya disimpan, Harness yang didukung, Lisensi, Pasang, Pengembangan, Perintah (+2 more)

### Community 48 - "tipeB-scripts/package.json"
Cohesion: 0.18
Nodes (10): kleur, picocolors, dependencies, kleur, description, devDependencies, picocolors, name (+2 more)

### Community 49 - "paths.ts"
Cohesion: 0.35
Nodes (7): expandHome(), adaptersRoot(), DATA_ROOT_ENV, DataRootOptions, platformPath(), resolveDataRoot(), statePath()

### Community 50 - "FakeProcessRunner"
Cohesion: 0.18
Nodes (7): 1. Claude Code (Anthropic), depsOf(), npmAvailable(), uvAvailable(), FakeProcessRunner, keyOf(), cloneRunner()

### Community 51 - "HANDOFF — Skill Manager"
Cohesion: 0.18
Nodes (10): 10. Cara melanjutkan, 1. Produk, 2. Keputusan yang terkunci, 3. Artefak yang sudah ada, 5. Fakta harness yang wajib diingat, 6. Kriteria penerimaan v0.1 (ringkas), 7. Ticket (urutan yang disarankan), 8. Dilarang muncul lagi tanpa ADR baru (+2 more)

### Community 52 - "atomic.ts"
Cohesion: 0.24
Nodes (8): quarantineCorruptState(), saveState(), AtomicDirectoryOptions, AtomicFileOptions, cleanup(), PopulateTempDirectory, TEMP_FILE_SUFFIX, writeFileAtomic()

### Community 53 - "uninstall.test.ts"
Cohesion: 0.29
Nodes (9): DATA_ROOT, Fixture, HOME, installedPath(), LIBRARY, mkdirp(), ok(), storePathHarness() (+1 more)

### Community 54 - "Agent Skills ecosystem, install tooling, registries, and "skill manager" prior art"
Cohesion: 0.20
Nodes (9): 3.1 Skills Manager — `xingkongliang/skills-manager` (mirror `shuv1337/skills-manager`), skillsmanager.dev, 3.2 Agent Skills Manager — `umutbozdag/agent-skills-manager`, 3.3 Adjacent, not skill managers, 3. Existing products that "manage skills across agents with on/off toggles", 4. Risks: injection, executable skills, provenance, incidents, 5. Licensing, 6. Hard-facts cheat sheet, 7. What I could NOT confirm (+1 more)

### Community 55 - "walk.ts"
Cohesion: 0.29
Nodes (8): ok(), ROOT, seed(), toPosix(), visit(), WalkOptions, WalkState, walkTree()

### Community 56 - "import-git.test.ts"
Cohesion: 0.24
Nodes (7): CLONE, DATA_ROOT, ok(), ROOT, seedFile(), seedSkill(), TEMP_ROOT

### Community 57 - "harnesses.ts"
Cohesion: 0.36
Nodes (8): recheck(), Harness, Scope, HarnessTargetView, HarnessView, registerHarnessRoutes(), targetsFor(), toView()

### Community 58 - "state.test.ts"
Cohesion: 0.28
Nodes (6): ok(), RenameFailingFs, ROOT, UnreadableFs, VALID_STATE, writeRawState()

### Community 59 - "scripts"
Cohesion: 0.25
Nodes (8): scripts, build, ci, format, lint, prepack, test, typecheck

### Community 60 - "2. Distribution / install tooling"
Cohesion: 0.25
Nodes (8): 2.2 Anthropic Claude Code plugins (`/plugin`) and skill installs, 2.3 Codex / ChatGPT skills, 2.4 OpenCode, 2.5 Cursor, 2.6 Gemini CLI / Antigravity, 2.7 Smithery / mcpmarket-style registries, 2.8 Cross-harness config sync ("dotfiles for AI"), 2. Distribution / install tooling

### Community 61 - "deps.ts"
Cohesion: 0.43
Nodes (7): planDependencies(), runDependencies(), planSchema, registerDepsRoutes(), runSchema, findSkill(), skillDirectory()

### Community 62 - "process-fake.ts"
Cohesion: 0.39
Nodes (5): DEFAULT_MAX_BUFFER_BYTES, DEFAULT_PROCESS_TIMEOUT_MS, FakeResponse, RecordedCall, ProcessRunOptions

### Community 63 - "12 — Verifikasi path dan perilaku harness yang belum pasti"
Cohesion: 0.29
Nodes (6): 12 — Verifikasi path dan perilaku harness yang belum pasti, Acceptance, Comments, Context, Notes, Scope

### Community 64 - "skill-source.ts"
Cohesion: 0.57
Nodes (6): findSkillDirectory(), hasSkillFile(), readSkillName(), resolveSkillDirectory(), SkillSourceErrorCode, sourceError()

### Community 65 - "Domain Docs"
Cohesion: 0.33
Nodes (5): Before exploring, read these, Domain Docs, File structure, Flag ADR conflicts, Use the glossary's vocabulary

### Community 66 - "Issue tracker: Local Markdown"
Cohesion: 0.33
Nodes (5): Conventions, Issue tracker: Local Markdown, Wayfinding operations, When a skill says "fetch the relevant ticket", When a skill says "publish to the issue tracker"

### Community 67 - "Rancangan fitur Katalog (catalog)"
Cohesion: 0.33
Nodes (5): Batas, Gol / non-gol, Keputusan (panggilan builder), Maksud, Rancangan fitur Katalog (catalog)

### Community 68 - "04 — Impor skill dari folder lokal"
Cohesion: 0.33
Nodes (5): 04 — Impor skill dari folder lokal, Acceptance, Comments, Context, Scope

### Community 69 - "05 — Impor skill dari git dan zip"
Cohesion: 0.33
Nodes (5): 05 — Impor skill dari git dan zip, Acceptance, Comments, Context, Scope

### Community 70 - "06 — Pasang skill ke Target (termasuk grup shared)"
Cohesion: 0.33
Nodes (5): 06 — Pasang skill ke Target (termasuk grup shared), Acceptance, Comments, Context, Scope

### Community 71 - "07 — Cabut skill dari Target"
Cohesion: 0.33
Nodes (5): 07 — Cabut skill dari Target, Acceptance, Comments, Context, Scope

### Community 72 - "09 — Dependensi skill (npm dan uv) dengan persetujuan"
Cohesion: 0.33
Nodes (5): 09 — Dependensi skill (npm dan uv) dengan persetujuan, Acceptance, Comments, Context, Scope

### Community 73 - "10 — UI: Skills, Matrix, Harnesses, Doctor"
Cohesion: 0.33
Nodes (5): 10 — UI: Skills, Matrix, Harnesses, Doctor, Acceptance, Comments, Context, Scope

### Community 74 - "11 — Fixture skill dan uji integrasi lintas OS"
Cohesion: 0.33
Nodes (5): 11 — Fixture skill dan uji integrasi lintas OS, Acceptance, Comments, Context, Scope

### Community 75 - "atomic.test.ts"
Cohesion: 0.40
Nodes (4): mkdirp(), ok(), RenameFailingFs, ROOT

### Community 76 - "Agent skills"
Cohesion: 0.40
Nodes (4): Agent skills, Domain docs, Issue tracker, Triage labels

### Community 77 - "dependencies"
Cohesion: 0.40
Nodes (5): dependencies, commander, hono, @hono/node-server, zod

### Community 78 - "1. The Agent Skills / SKILL.md format"
Cohesion: 0.40
Nodes (5): 1.1 Who publishes it, 1.2 Directory layout, 1.3 Frontmatter fields (exact), 1.4 Validation rules (reference implementation), 1. The Agent Skills / SKILL.md format

### Community 79 - "vite.config.ts"
Cohesion: 0.50
Nodes (3): @tailwindcss/vite, vite, @vitejs/plugin-react

### Community 80 - "Jebakan yang sudah ditemukan (JANGAN diulang)"
Cohesion: 0.50
Nodes (4): Alat, Jebakan yang sudah ditemukan (JANGAN diulang), Lingkungan mesin ini, Windows

### Community 82 - "repository"
Cohesion: 0.67
Nodes (3): repository, type, url

### Community 83 - "9. Roo Code and Kilo Code (same lineage, different paths, same spec)"
Cohesion: 0.67
Nodes (3): 9. Roo Code and Kilo Code (same lineage, different paths, same spec), Kilo Code, Roo Code

### Community 84 - "Apa yang dibangun"
Cohesion: 0.67
Nodes (3): Apa yang dibangun, Store map, Struktur kode

### Community 85 - "Pekerjaan yang MASIH tersisa"
Cohesion: 0.67
Nodes (3): Menunggu keputusan manusia (jangan dikerjakan sendiri), Pekerjaan yang MASIH tersisa, Perbaikan kode yang belum dikerjakan

## Knowledge Gaps
- **10 isolated node(s):** `@biomejs/biome`, `@types/node`, `@types/react`, `@types/react-dom`, `tailwindcss` (+5 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 624 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **20 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `ref_node_path` to `harness.ts`, `fixture.ts`, `commands.ts`, `model.ts`, `App.tsx`, `staging.ts`, `app.ts`, `errors.ts`, `fs/types.ts`, `confirm.ts`, `api.ts`, `views.test.tsx`, `.mkdir`, `state.ts`, `package.json`, `import-zip.test.ts`, `detect.test.ts`, `targets.test.ts`, `install.test.ts`, `catalog.ts`, `process-node.ts`, `guard.ts`, `frontmatter.ts`, `paths.ts`, `uninstall.test.ts`, `walk.ts`, `import-git.test.ts`, `state.test.ts`, `process-fake.ts`, `atomic.test.ts`?**
  _High betweenness centrality (0.175) - this node is a cross-community bridge._
- **Are the 7 inferred relationships involving `FileSystem` (e.g. with `Pengembangan` and `4. Konvensi kode`) actually correct?**
  _`FileSystem` has 7 INFERRED edges - model-reasoned connections that need verification._
- **What connects `@biomejs/biome`, `@types/node`, `@types/react` to the rest of the system?**
  _10 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `ref_node_path` be split into smaller, more focused modules?**
  _Cohesion score 0.05303030303030303 - nodes in this community are weakly interconnected._
- **Why does `FileSystem` connect `FileSystem` to `ref_node_path`, `harness.ts`, `commands.ts`, `adapters/index.ts`, `staging.ts`, `Skill Manager — Spec v0.1`, `import-folder.ts`, `MemoryFileSystem`, `core/types.ts`, `FsResult`, `errors.ts`, `maintenance/sync.ts`, `fs/types.ts`, `loadAdapters`, `SkillManagerError`, `install.ts`, `import-zip.ts`, `.mkdir`, `state.ts`, `import-git.ts`, `import-zip.test.ts`, `detect.test.ts`, `inspect.ts`, `install.test.ts`, `guard.ts`, `Skill Manager`, `atomic.ts`, `walk.ts`, `import-git.test.ts`, `skill-source.ts`, `11 — Fixture skill dan uji integrasi lintas OS`, `atomic.test.ts`, `Apa yang dibangun`?**
  _High betweenness centrality (0.137) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `MemoryFileSystem` (e.g. with `9. Testing` and `Risiko v0.1 yang sudah diterima`) actually correct?**
  _`MemoryFileSystem` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Should `harness.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05010351966873706 - nodes in this community are weakly interconnected._