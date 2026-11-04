# Agent Skills ecosystem, install tooling, registries, and "skill manager" prior art

Research date: **2026-11-05** (Asia/Jakarta). Every claim below is traced to a primary source URL.
Anything I could not verify first-hand is marked **UNVERIFIED** (see section 7).

Scope: what a cross-harness "skill manager" desktop app must know — format, paths, precedence,
native enable/disable, symlink behaviour, registry/install internals, prior art, risk, licensing.

---

## 1. The Agent Skills / SKILL.md format

### 1.1 Who publishes it

| Fact | Source |
| - | - |
| Canonical home is **agentskills.io**; repo is **github.com/agentskills/agentskills** ("Specification and documentation for Agent Skills", ~26.9k stars, default branch `main`). | https://agentskills.io/specification · https://github.com/agentskills/agentskills |
| Origin: "The Agent Skills format was originally developed by **Anthropic**, released as an open standard, and has been adopted by a growing number of agent products." | https://github.com/agentskills/agentskills/blob/main/README.md |
| Repo licensing: **code Apache-2.0, documentation CC-BY-4.0**. | https://github.com/agentskills/agentskills/blob/main/README.md |
| A copy of the spec also ships inside Anthropic's skills repo (`anthropics/skills/spec`). | https://api.github.com/repos/anthropics/skills/contents/ |
| Anthropic's product-level description of the same format (progressive disclosure, 3 levels, API `container.skills`) | https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview.md |

### 1.2 Directory layout

```
skill-name/
├── SKILL.md          # Required: YAML frontmatter + markdown body
├── scripts/          # Optional: executable code
├── references/       # Optional: docs loaded on demand (REFERENCE.md, FORMS.md, ...)
├── assets/           # Optional: templates, images, data
└── ...               # Any additional files/dirs allowed
```
Source: https://agentskills.io/specification

- `SKILL.md` must contain YAML frontmatter followed by Markdown; the spec imposes **no restrictions on the body**.
- Progressive-disclosure budget: metadata ~100 tokens (name+description for all skills), body **< 5000 tokens**,
  `SKILL.md` **under 500 lines**, references one level deep.
- Codex adds an optional `agents/openai.yaml` (appearance/dependencies) — host-specific extension, not part of the standard
  (https://learn.chatgpt.com/codex/skills.md).

### 1.3 Frontmatter fields (exact)

| Field | Required | Constraint (spec text) |
| - | - | - |
| `name` | yes | ≤ **64** chars; lowercase letters/digits/hyphens; no leading/trailing `-`; no `--`; **must equal the parent directory name** |
| `description` | yes | **1–1024** chars, non-empty; should say what + when |
| `license` | no | license name or reference to a bundled license file |
| `compatibility` | no | ≤ **500** chars; environment requirements |
| `metadata` | no | map of **string → string**; free-form, "make keys reasonably unique" |
| `allowed-tools` | no | **space-separated string** of pre-approved tools, e.g. `Bash(git:*) Bash(jq:*) Read`; marked **experimental** |

Source: https://agentskills.io/specification

**Claude Code extends the field set.** Full list for `skills/<name>/SKILL.md`:
`name, description, when_to_use, argument-hint, arguments, disable-model-invocation, user-invocable,
allowed-tools, disallowed-tools, model, effort, context, agent, background, hooks, paths, shell, metadata, license, compatibility`.
Sources: https://code.claude.com/docs/en/claude-directory.md · https://code.claude.com/docs/en/skills.md (Frontmatter reference)

Other Claude Code rules that matter to a manager app:
- **All fields are optional in Claude Code**; only `description` is "recommended".
- `description` + `when_to_use` is **truncated at 1,536 chars** in the skill listing.
- Frontmatter is only parsed when the opening `---` is the file's **first line**; unparseable YAML ⇒ skill still loads with **no fields**.

### 1.4 Validation rules (reference implementation)

`skills-ref validate ./my-skill` (Python, in `agentskills/agentskills/skills-ref`).
Source: https://agentskills.io/specification · https://github.com/agentskills/agentskills/tree/main/skills-ref

Actual validator logic (https://github.com/agentskills/agentskills/blob/main/skills-ref/src/skills_ref/validator.py):

- `MAX_SKILL_NAME_LENGTH = 64`, `MAX_DESCRIPTION_LENGTH = 1024`, `MAX_COMPATIBILITY_LENGTH = 500`.
- **Strict allow-list**: `ALLOWED_FIELDS = {name, description, license, allowed-tools, metadata, compatibility}`.
  Any extra key ⇒ error "Unexpected fields in frontmatter: ...".
- Name: NFKC-normalized, must be lowercase, no leading/trailing `-`, no `--`, every char must satisfy
  `c.isalnum() or c == "-"`, and **directory name must equal `name`**.
- **Discrepancy:** the website says "lowercase alphanumeric (a-z, 0-9)", but the validator uses `str.isalnum()` and its
  docstring says "Skill names support i18n characters (Unicode letters)". So non-ASCII names validate but contradict the prose spec.
  **UNVERIFIED** which behaviour hosts implement.
- **Critical gotcha:** because of the strict allow-list, a Claude-Code-style skill carrying `disable-model-invocation`,
  `when_to_use`, `context`, `paths`, `hooks` **fails** `skills-ref validate`. "skills-ref clean" ≠ "valid everywhere".

Codex's rule is looser: "The `SKILL.md` file must include `name` and `description`" (https://learn.chatgpt.com/codex/skills.md).
OpenCode requires `name` + `description`, ignores unknown fields, and enforces `^[a-z0-9]+(-[a-z0-9]+)*$` plus dir-name match
(https://opencode.ai/docs/skills).

---

## 2. Distribution / install tooling

### 2.1 vercel-labs `skills` CLI (`npx skills`, skills.sh)

Repo https://github.com/vercel-labs/skills — **MIT**, npm package `skills`, requires **Node ≥ 22.20**.

**Commands:** `add, find, list, use, check, update, remove/rm, init`, plus experimental `experimental_sync` /
`experimental_install` (npm-dependency-distributed skills, `skills` array in package.json, `skills-lock.json`).

**Supported agents:** "OpenCode, Claude Code, Codex, Cursor, and **75 more**" (README). Full project/global path table:
https://github.com/vercel-labs/skills/blob/main/docs/agents.md — 79 rows incl. AiderDesk, Amp, Antigravity, Claude Code,
OpenClaw, Cline, Codex, Copilot, Cursor, Gemini CLI, Goose, Kiro, OpenCode, Qwen, Roo, Trae, Windsurf, Zed.

**Where it installs — canonical store + links** (`src/installer.ts`, `src/constants.ts`):

| | Path |
| - | - |
| Canonical, project | `<cwd>/.agents/skills/<skill>` |
| Canonical, global (`-g`) | `~/.agents/skills/<skill>` |
| Per-agent project | `<agent.skillsDir>`, e.g. `.claude/skills/`, `.cursor/skills/` |
| Per-agent global | `agent.globalSkillsDir`, e.g. `~/.claude/skills/`, `~/.config/opencode/skills/` |

**Install modes** (`InstallMode` in installer.ts):
- `symlink` (**default**): copy into the canonical dir, then **symlink each agent dir → canonical**.
- `copy`: independent copies directly into each agent dir (CLI flag `--copy`).
- `link`: symlink the canonical dir to the skill's *source* (e.g. inside `node_modules`), then link agent dirs.
- **Windows:** `symlinkType = platform() === 'win32' ? 'junction' : undefined` and junctions get the **absolute** resolved target.
  If symlink creation fails it **falls back to copy** and reports `symlinkFailed: true`.
- "Universal" agents (Amp/Replit, Codex/Cline/Cursor/Gemini/Copilot/…) already read `.agents/skills`, so the CLI **skips**
  creating their per-agent link to avoid duplicate listings.

**Does it track installs? Yes — two JSON lockfiles** (`src/skill-lock.ts`, `src/local-lock.ts`):
- Global: `$XDG_STATE_HOME/skills/.skill-lock.json`, else `~/.agents/.skill-lock.json`; `version: 3`; entries carry
  `source, sourceType, sourceUrl, ref, skillPath, skillFolderHash` (GitHub tree SHA), `installedAt, updatedAt, installMode`,
  plus `lastSelectedAgents` and dismissed-prompt state.
- Project: `<project>/skills-lock.json`, `version: 1`, entries `source, sourceType, sourceUrl?, ref, skillPath, version?, via?, computedHash`
  (SHA-256 over all files on disk), `installMode`, `subagents?`. Designed to be **committed** and merge-friendly (sorted keys, no timestamps).

**Registry / network surface:** search + download go to `https://skills.sh`, overridable with `SKILLS_API_URL` and
`SKILLS_DOWNLOAD_URL` (`src/find.ts`, `src/blob.ts`). Anonymous telemetry + "security-audit requests" (only for repos GitHub
confirms are public); disable with `DISABLE_TELEMETRY=1` / `DO_NOT_TRACK=1`. Other env vars: `INSTALL_INTERNAL_SKILLS`
(skills marked `internal: true`), `GITHUB_TOKEN`, `GH_TOKEN`, `SKILLS_DOWNLOAD_MAX_BYTES` (10 MiB),
`SKILLS_EXTRACT_MAX_BYTES` (25 MiB), `SKILLS_EXTRACT_MAX_FILES` (1000).
Sources: https://github.com/vercel-labs/skills/blob/main/docs/commands.md · .../docs/troubleshooting.md

**Safety behaviour already in the installer** (good prior art): recursive copy **dereferences** symlinks, **skips** links that
point outside the skill root, skips directory cycles; the archive/tar path **rejects symlinks outright**;
downloads are size/count-capped.

**skills.sh the site** = directory + leaderboard with **install counts** (e.g. #1 `find-skills` at 4.2M) and an **/audits** page
aggregating security results from **Gen Agent Trust Hub, Socket and Snyk** per skill (Safe / N alerts / risk level).
Sources: https://www.skills.sh · https://www.skills.sh/audits

**No enable/disable.** The CLI only adds, updates and removes; there is no "installed but off" state.

### 2.2 Anthropic Claude Code plugins (`/plugin`) and skill installs

- A plugin = directory of skills/agents/hooks/MCP servers + manifest `.claude-plugin/plugin.json`. A **marketplace** = repo/dir with
  `.claude-plugin/marketplace.json` listing plugins ("a catalog, not a hosted store"). https://code.claude.com/docs/en/plugins.md
- Install: `/plugin install <plugin>@<marketplace>`, `/plugin marketplace add <owner/repo>`, or `claude plugin install|disable`.
- **On-disk:** one plugins root — `~/.claude/plugins/` unless **`CLAUDE_CODE_PLUGIN_CACHE_DIR`** is set; marketplaces are cloned to
  `marketplaces/<name>/`; `plugins/.trash/` holds removed synced plugins.
  https://code.claude.com/docs/en/plugins/loading.md · https://code.claude.com/docs/en/claude-directory.md
- **Enable state is a settings key, not a file move:** `enabledPlugins` in `~/.claude/settings.json` (user),
  `.claude/settings.json` (project), `.claude/settings.local.json` (local). Precedence **local > project > user**.
  Authors can ship `defaultEnabled: false`. https://code.claude.com/docs/en/plugins/install.md
- Plugin skills appear as `<plugin>:<skill>` in the `/` menu.
- `anthropics/skills` is itself a marketplace: `/plugin marketplace add anthropics/skills` then
  `/plugin install document-skills@anthropic-agent-skills`. https://github.com/anthropics/skills/blob/main/README.md

### 2.3 Codex / ChatGPT skills

Source: https://learn.chatgpt.com/codex/skills.md (`developers.openai.com/codex/skills` redirects here)

| Scope | Location |
| - | - |
| REPO | `$CWD/.agents/skills`, `$CWD/../.agents/skills`, `$REPO_ROOT/.agents/skills` (scans every dir up to repo root) |
| USER | `$HOME/.agents/skills` |
| ADMIN | `/etc/codex/skills` |
| SYSTEM | bundled (`skill-creator`, `skill-installer`) |

- **"Codex supports symlinked skill folders and follows the symlink target when scanning these locations."** (explicit in doc)
- Duplicate names are **not merged**; both can appear in skill selectors.
- The initial list includes each skill's **file path**, budgeted at 2% of context (or 8,000 chars), configurable via
  `skills.max_context_tokens` (cap 10,000); Codex **shortens descriptions first**, then may omit skills with a warning.
- `$skill-installer <name>` installs curated skills locally; distribution goes through OpenAI **plugins**.
- **Native enable/disable exists in config:** `skills.config` = array of `{ name | path, enabled }`; "If several rules match a
  skill, the last one wins." Also `skills.bundled.enabled`, `skills.include_instructions`, `features.skill_mcp_dependency_install`,
  granular approval `approval_policy.granular.skill_approval`.
  https://learn.chatgpt.com/docs/config-file/config-reference.md

### 2.4 OpenCode

Source: https://opencode.ai/docs/skills

- Discovery: project `.opencode/skills/<name>/SKILL.md`, `.claude/skills/`, `.agents/skills/`; global `~/.config/opencode/skills/`,
  `~/.claude/skills/`, `~/.agents/skills/`. Project dirs are walked **up to the git worktree root**.
- **Native per-skill switch:** `permission.skill` map with `allow` / `deny` / `ask` and wildcards (`internal-*`), overridable per
  agent (custom-agent frontmatter or `agent.<name>.permission.skill` in `opencode.json`).
- Whole-tool kill switch: `tools.skill: false`.
- Unknown frontmatter fields ignored; "OpenCode 1 does not use metadata to control slash commands or automatic skill selection."

### 2.5 Cursor

Source: https://cursor.com/docs/context/skills

- Loads `.agents/skills/`, `.cursor/skills/` (project) and `~/.agents/skills/`, `~/.cursor/skills/` (user).
- Built-in Cursor skills (`/create-skill`, `/migrate-to-skills`, …). User-level skills are **not** copied to Cloud Agents,
  remote SSH sessions, or self-hosted workers.
- No documented per-skill on/off switch. **UNVERIFIED** whether one exists.

### 2.6 Gemini CLI / Antigravity

Source: https://geminicli.com/docs/cli/skills/

- Precedence (lowest → highest): **built-in → extension → user → workspace**.
  user = `~/.gemini/skills/` or `~/.agents/skills/` alias; workspace = `.gemini/skills/` or `.agents/skills/` alias.
- **Within a tier the `.agents/skills/` alias wins over `.gemini/skills/`.** Same-name collisions resolve by precedence.
- Activation requires an explicit **user consent prompt** naming the skill and the directory it will gain access to (good UX prior art).
- Site banner: "Gemini CLI was replaced by **Antigravity CLI** on June 18th, 2026" for unpaid/Google One tiers.

### 2.7 Smithery / mcpmarket-style registries

- **Smithery** is an **MCP** registry, not a skill registry. Its MCP Proxy, API, Connect, Toolbox, accounts/keys, CLI and SDKs were
  **shut down on 2026-10-31**; it remains "a public (non-proxied) MCP registry" now powered by Arcade.dev. https://www.smithery.ai/docs
- **MCP Market "Hub"** markets itself as "Version Control for Agent Skills & MCPs": draft/publish/version/rollback skills, import from
  GitHub, sync through a plugin, team workspaces, URL-addressable skills (`mcpmarket.com/<org>/skills/<name>`). https://mcpmarket.com/hub
- **Chainguard** runs a signed skill registry (`skills.cgr.dev`) — see §4.

### 2.8 Cross-harness config sync ("dotfiles for AI")

| Tool | Model | Source |
| - | - | - |
| **rulesync** (`dyoshikawa/rulesync`, npm) | Single source of truth in `.rulesync/`; **generates** per-tool config; supports rules, commands, MCP, ignore files, subagents and **skills** across ~20+ tools; `rulesync import` / `rulesync convert --from --to` | https://github.com/dyoshikawa/rulesync |
| **ruler** (`intellectronica/ruler`, MIT, beta) | Central `.ruler/` + `ruler.toml`; **applies/copies** rules and MCP into each agent's files; per-tool skills + subagent dirs in a support table; gitignore automation for generated files | https://github.com/intellectronica/ruler |
| **aiconfig** | No evidence of a skill/agent-config sync tool. **UNVERIFIED** | — |

Both **copy/generate** files rather than maintaining a symlink farm, and neither has a per-skill toggle UI.
Their path tables also **disagree with vercel's**: ruler says Cursor → `.cursor/skills/` and Copilot → `.github/skills/`,
while vercel says both project paths are `.agents/skills/`. Path tables rot — a manager app must verify on disk, not trust tables.

---

## 3. Existing products that "manage skills across agents with on/off toggles"

### 3.1 Skills Manager — `xingkongliang/skills-manager` (mirror `shuv1337/skills-manager`), skillsmanager.dev

Source: https://github.com/shuv1337/skills-manager (README mirrors https://github.com/xingkongliang/skills-manager)

- Desktop app (Homebrew cask, `.exe`/`.msi`, AppImage/deb/rpm, Scoop). Ships a CLI inside the app.
- **Model:** one **central repo**, default `~/.skills-manager`, path configurable. Import from Git / local folder / `.zip` / `.skill` /
  skills.sh marketplace.
- **Sync model:** per-skill **symlink or copy** into each agent dir ("Multi-tool sync ... via symlink or copy with one click"),
  per-agent icon badges reflecting live state, batch enable/disable.
- **Workspaces:** Global Workspace (per agent; scans the real folder including skills installed outside the app),
  Project Workspaces (project-local folders, two-way sync), Linked Workspaces (arbitrary dirs), **Presets**
  ("Applying a preset is a **one-time copy, not a live sync**").
- **Extras:** tags/filters, upstream update checks, SKILL.md/README preview + diff, custom tools and path overrides,
  **backup & multi-device sync over a private GitHub repo / any Git remote** with skill-aware merge + snapshots,
  activity log, in-app updater, **agent-drivable CLI** so agents install/deploy via the app.

**Gaps (my analysis):**
- Its own central store is **not** the ecosystem's canonical `.agents/skills`, so `npx skills` and Skills Manager keep
  **two parallel sources of truth**; it does not consume `skills-lock.json`.
- Toggle = link/copy present or absent. It does **not** use native switches (`skillOverrides`, `enabledPlugins`, Codex
  `skills.config`, OpenCode `permission.skill`), so it mutates the filesystem and cannot express `name-only` / `ask` states.
- Presets are one-shot copies ⇒ drift.
- No signing/verification, no audit integration, no lockfile interop.
- Windows symlink primitive not stated. **UNVERIFIED**.

### 3.2 Agent Skills Manager — `umutbozdag/agent-skills-manager`

Source: https://github.com/umutbozdag/agent-skills-manager

- Dashboard over ~11 tools (Cursor, Claude, Windsurf, Copilot, Codex, Cline, Aider, Continue, Roo, Augment, "Agents").
- **Toggle model:** "renames between `SKILL.md` and `SKILL.md.disabled`" — no central store, no links.
- Also scans plugin caches (`~/.cursor/plugins/cache/…/skills/`), single-file configs, project dirs; git-clone install;
  bulk copy/move/delete; built-in terminal.

**Gaps:** in-place rename is invisible to any lockfile/registry and breaks for hosts that require an exact `SKILL.md` (and for
shared dirs read by several agents); no provenance, no update tracking, no precedence resolution.

### 3.3 Adjacent, not skill managers

`npx skills` (install/update/remove + lockfile, no toggles/UI) · Claude Code `/plugin` + `/skills` menu + `/skill-doctor`
(native, single harness) · MCP Market Hub (hosted versioned registry + sync plugin) · rulesync / ruler (config generators).

**Gap that remains:** nobody combines (a) a real **precedence model** per harness (including `.agents/skills` aliasing and
duplicate-name shadowing), (b) **toggle via native config where it exists, links/rename where it doesn't**, (c) **lockfile interop**,
(d) **provenance/audit before install**, and (e) correct **Windows junction** semantics.

---

## 4. Risks: injection, executable skills, provenance, incidents

An enabled skill's name+description enters context every turn, and its body can tell the agent to run bundled `scripts/` with the
user's credentials and network ("lethal trifecta"). Sources: https://snyk.io/articles/skill-md-shell-access/ ·
https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview.md

| Item | Numbers | Source |
| - | - | - |
| **ClawHavoc** on ClawHub (OpenClaw registry), Jan–Feb 2026 | Snyk: **341 malicious of 2,857** audited skills (~12%), delivering **Atomic Stealer (AMOS)** macOS infostealer. OWASP AST10 instead cites **1,184 malicious skills** (Antiy CERT, Feb 2026) — counts conflict | https://snyk.io/articles/skill-md-shell-access/ · https://github.com/OWASP/www-project-agentic-skills-top-10 |
| **Snyk "ToxicSkills"** 2026 scan | 3,984 skills scanned, **36.82%** with security flaws, **13.4%** critical, 76+ confirmed malicious payloads | https://github.com/OWASP/www-project-agentic-skills-top-10 |
| **Claude Code RCE CVEs** cited by OWASP AST10 | CVE-2025-59536 / CVE-2025-21852 (Check Point Research, Feb 2026) | same — **UNVERIFIED** in NVD |
| **OWASP Agentic Skills Top 10 (AST10)** | v1.0-2026, CC BY-SA 4.0, 10 risks mapped to CSA MAESTRO | https://owasp.org/www-project-agentic-skills-top-10/ |

> Caution: the AST10 README describes platform formats as "SKILL.md (OpenClaw), skill.json (Claude Code), manifest.json
> (Cursor/Codex), package.json (VS Code)". First-party docs show Claude Code, Codex and Cursor all read `SKILL.md`.
> Treat that line as **UNVERIFIED / probably stale**.

**Provenance / signing**

- **Chainguard**: every skill published to `skills.cgr.dev` is signed as a **Sigstore bundle** over the skill's **manifest digest**
  (OCI-style refs with tags/digests). `chainctl skills verify <ref>` or **Cosign ≥ 3.1.1**; statuses
  `verified | unsigned | failed | skipped`; `chainctl skills install --verify` checks **before writing to disk**.
  `chainctl skills validate` is format-only and "says nothing about who published a skill".
  https://www.chainguard.dev/docs/chainguard/agent-skills/verifying-skills.md
- **skills.sh Audits** aggregates Gen Agent Trust Hub + Socket + Snyk verdicts per skill. https://www.skills.sh/audits
- The **spec has no signature/provenance field** — only free-text `license` and a `metadata` bag. https://agentskills.io/specification
- No cross-harness standard for "signed by X, verified by installer Y". **UNVERIFIED** whether any harness consumes Chainguard
  signatures natively (verification appears `chainctl`-mediated).

**Mitigations a manager app can do today:** flag `scripts/` + `allowed-tools` as risk; diff before install; SHA-256 folder hash;
refuse symlinks escaping the skill root; pin commit/digest; surface audit verdict.
Harness guards that already exist: Claude Code `disableSkillShellExecution`, `strictPluginOnlyCustomization.skills`,
`disable-model-invocation`; Codex `approval_policy.granular.skill_approval`; OpenCode `permission.skill: ask`;
Gemini's per-activation consent prompt.

---

## 5. Licensing

- **Spec:** Apache-2.0 (code) + **CC-BY-4.0** (documentation). Copying/normalizing SKILL.md files is unencumbered; reproducing spec
  *documentation* text in an app/help requires attribution. https://github.com/agentskills/agentskills/blob/main/README.md
- **CLI:** `vercel-labs/skills` is **MIT** — safe to vendor or reimplement. https://github.com/vercel-labs/skills
- **Anthropic skills:** "Many skills in this repo are open source (**Apache 2.0**)", but the document skills
  (`skills/docx`, `skills/pdf`, `skills/pptx`, `skills/xlsx`) are **"source-available, not open source"** — do **not** bundle or
  redistribute them. No root LICENSE (GitHub API reports `license: null`); permissions are per-skill.
  https://github.com/anthropics/skills/blob/main/README.md · https://api.github.com/repos/anthropics/skills
- Skills are **not uniformly MIT**: `license` is free text ("Apache-2.0", "Proprietary. LICENSE.txt has complete terms", …) and is not
  machine-enforced. https://agentskills.io/specification
- Practical rule: copy files, never strip `license`/`LICENSE`/`THIRD_PARTY_NOTICES`, show the license before install, keep origin
  URL + ref. (Design recommendation, not a source claim.)

---

## 6. Hard-facts cheat sheet

**Paths**

| Harness | Project | Global | Env override |
| - | - | - | - |
| Shared canonical (vercel CLI, Codex, Cursor, Gemini alias, Copilot per vercel) | `.agents/skills/` | `~/.agents/skills/` | — |
| Claude Code (skills) | `.claude/skills/` | `~/.claude/skills/` | additional dirs via `--add-dir` |
| Claude Code (plugins) | `.claude/settings.json` `enabledPlugins` | `~/.claude/plugins/` + `~/.claude/settings.json` | `CLAUDE_CODE_PLUGIN_CACHE_DIR` |
| OpenCode | `.opencode/skills/`, `.claude/skills/`, `.agents/skills/` | `~/.config/opencode/skills/`, `~/.claude/skills/`, `~/.agents/skills/` | — |
| Cursor | `.agents/skills/`, `.cursor/skills/` | `~/.agents/skills/`, `~/.cursor/skills/` | — |
| Codex | `$CWD/.agents/skills` … `$REPO_ROOT/.agents/skills` | `$HOME/.agents/skills`; admin `/etc/codex/skills` | — |
| Gemini CLI | `.gemini/skills/`, `.agents/skills/` | `~/.gemini/skills/`, `~/.agents/skills/` | — |
| vercel CLI lockfiles | `skills-lock.json` | `$XDG_STATE_HOME/skills/.skill-lock.json` else `~/.agents/.skill-lock.json` | `XDG_STATE_HOME` |

**Native enable/disable**

| Harness | Mechanism | Granularity |
| - | - | - |
| Claude Code (skills) | `skillOverrides: {name: "on"\|"name-only"\|"user-invocable-only"\|"off"}`, written by `/skills` menu (Space cycles) into `.claude/settings.local.json`; absent = on; **does not apply to plugin skills** | per skill name |
| Claude Code (plugins) | `enabledPlugins` in user/project/local settings; `/plugin`, `claude plugin disable` | per plugin |
| Codex | `skills.config: [{name\|path, enabled}]`, last match wins; `skills.bundled.enabled` | per name or per SKILL.md path |
| OpenCode | `permission.skill` allow/deny/ask + wildcards, per-agent override; `tools.skill: false` | pattern → skill |
| Cursor | none documented | — |
| Gemini CLI | none documented (consent prompt per activation) | — |
| vercel CLI / Skills Manager / Agent Skills Manager | **none native** — link present/absent, copy present/absent, or file rename | — |

**Symlinks / junctions**
- vercel CLI: default symlink, **junction on Windows with absolute target**, copy fallback, skips redundant links for universal agents.
- Codex: documented to follow symlinked skill folders.
- Claude Code / Cursor / OpenCode: symlink following **not documented** → **UNVERIFIED**.

**Precedence**
- Gemini: built-in < extension < user < workspace; `.agents` alias beats `.gemini` inside a tier.
- Claude Code: exact enterprise/personal/project/additional-dir order **not retrieved** (see §7). The Agent SDK doc says a clashing
  skill in an added directory gets a **prefixed name** (`web:verify`) when it clashes with an "enterprise, personal, or project"
  skill — implying that ordering.
- Codex: no merge — duplicates coexist. OpenCode: names must be unique; `deny` hides.

---

## 7. What I could NOT confirm

1. **Claude Code's "Where skills live" table and precedence rules.** `code.claude.com/docs/en/skills.md` exceeds the fetcher's
   100k-char cap and the section sits past the cutoff; only surrounding anchors exist (`#where-skills-live`,
   `#skills-from-additional-directories`, `#how-a-skill-gets-its-command-name`). I did not substitute a third-party summary.
2. Whether **Claude Code, Cursor, OpenCode follow symlinks/junctions** on Windows (only Codex documents it).
3. Whether **Copilot** skills live in `.github/skills/` (ruler) or `.agents/skills/` (vercel) — GitHub's docs page rendered as nav only.
4. Whether **skills.sh has a public/documented REST API** — only internal endpoints reachable via `SKILLS_API_URL` / `SKILLS_DOWNLOAD_URL`.
5. Whether any harness **natively verifies** Chainguard/Sigstore signatures.
6. The two **ClawHavoc counts** (341 vs 1,184) — irreconcilable from the two sources read.
7. **Claude Code CVE IDs** — sourced only to OWASP AST10, not NVD/Check Point directly.
8. Whether renaming **SKILL.md → SKILL.md.disabled** is honoured as "disabled" by any first-party harness.
9. **`aiconfig`** as a skill manager: no evidence found.
10. Exact **spec version number / governance RFC state** — the site is unversioned prose.
