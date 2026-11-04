# Harness Skill Paths — Where AI coding agents store skills, and how enable/disable works

**Status:** environment research for the "skill manager" desktop app.
**Research date:** 2026-11-05 (docs sampled live; several vendors ship weekly — re-verify at build time).
**Method:** vendor docs and vendor source repos only (URLs inline). Anything not confirmed from a primary source is marked **UNVERIFIED**.

Also answered here: which harnesses follow the same on-disk "Agent Skills" format, which have a native per-skill enable/disable a manager can write to, and how to detect an install.

---

## 0. The shared spec everyone is converging on

- **Agent Skills specification** — a skill is a *directory* containing `SKILL.md` (YAML frontmatter + Markdown) plus optional `scripts/`, `references/`, `assets/`.
  Frontmatter: `name` (required, max 64 chars, lowercase letters/digits/hyphens, no leading/trailing hyphen), `description` (required, max 1024 chars), `license`, `compatibility` (max 500), `metadata` (string to string map), `allowed-tools` (experimental, space separated).
  Source: <https://agentskills.io/specification>
- **Progressive disclosure** is the norm: only name + description are preloaded; body and resources load on activation. Every harness below does this.
- The cross-tool root directory that emerged in 2025/2026 is `.agents/skills/` (project) and `~/.agents/skills/` (user). See section 19 — the key design fact for a skill manager.

Legend: **U** = user/global scope, **P** = project scope.

---

## 1. Claude Code (Anthropic)

1. **Skills:** Yes, and it is the reference implementation. "Claude Code skills follow the Agent Skills open standard… Claude Code extends the standard with invocation control, subagent execution, dynamic context injection." Custom slash commands merged into skills: `.claude/commands/deploy.md` and `.claude/skills/deploy/SKILL.md` both create `/deploy`. (<https://code.claude.com/docs/en/skills>)
2. **Paths**
   - U: `~/.claude/skills/<name>/SKILL.md` → Windows `%USERPROFILE%\.claude\skills\<name>\SKILL.md`
   - P: `.claude/skills/<name>/SKILL.md`; nested `<subdir>/.claude/skills/` (loads when Claude touches files there, or eagerly via `/add-dir`)
   - Enterprise: `.claude/skills/` inside the managed-settings directory
   - Added dirs: `<dir>/.claude/skills/` for each `--add-dir` / `/add-dir`
   - Plugin: `<plugin>/skills/<name>/SKILL.md` → invoked as `/plugin-name:skill-name`
   - claude.ai-synced skills land in `~/.claude/skills/synced/` (reserved folder name)
   - Env override: **CLAUDE_CONFIG_DIR** relocates the whole `~/.claude` tree (settings, history, plugins). "On Windows, `~/.claude` means `%USERPROFILE%\.claude`." (<https://code.claude.com/docs/en/settings>)
3. **Precedence:** Enterprise > personal > project for identical names. A `.claude/commands/` file loses to a same-named skill. Plugin skills are namespaced so they coexist. Root vs nested: both load; root wins `/deploy`, nested runs as `/apps/web:deploy`. Added-directory skill gets a prefix on collision (`/cli:verify`).
4. **Symlinks:** Explicitly supported. "a `<skill-name>` entry in the enterprise, personal, or project location can be a symlink to a directory elsewhere on disk… loads the skill once even if several locations point at the same target." (Plugin skills differ.) Reserved names that will not load: `synced`, `anthropic-skills`.
5. **Native enable/disable:** Yes, per skill.
   - `skillOverrides` in any settings file (user `~/.claude/settings.json`, project `.claude/settings.json`, `.claude/settings.local.json`, managed): values `on` | `name-only` | `user-invocable-only` | `off`. `off` hides it from the model and from the `/` menu. The `/skills` menu writes it (Space cycles, Esc saves to `.claude/settings.local.json`).
   - `disableBundledSkills: true` global switch; per-bundled skill via `skillOverrides` (e.g. `doctor`: `off`).
   - Frontmatter: `disable-model-invocation: true`, `user-invocable: false`.
6. **Other customization files:** `CLAUDE.md` (+ `~/.claude/CLAUDE.md`), `.claude/commands/*.md`, `.claude/agents/*` (subagents), `.claude/settings.json` / `settings.local.json`, `~/.claude.json` (app-managed state: account, MCP servers, trust decisions), hooks, MCP (`.mcp.json`), plugins.
7. **Detection:** `claude` on PATH — native installer puts it at `~/.local/bin/claude` (macOS/Linux, symlink into `~/.local/share/claude/versions/`) or `%USERPROFILE%\.local\bin\claude.exe` (Windows); also Homebrew cask `claude-code`, `winget Anthropic.ClaudeCode`. Config: `~/.claude` + `~/.claude.json`. The VS Code extension bundles a private CLI and does *not* put `claude` on PATH. (<https://code.claude.com/docs/en/setup>, <https://code.claude.com/docs/en/troubleshoot-install>)

---

## 2. OpenAI Codex CLI

1. **Skills:** Yes — "Skills build on the open agent skills standard (agentskills.io)". Works in Codex CLI, ChatGPT desktop, IDE extension. (<https://learn.chatgpt.com/codex/skills.md>)
2. **Paths** (note: **`.agents/skills`, not `.codex/skills`**, is current)
   - P: `$CWD/.agents/skills`, every `.agents/skills` between CWD and repo root, and `$REPO_ROOT/.agents/skills`
   - U: `$HOME/.agents/skills` → Windows `%USERPROFILE%\.agents\skills`
   - Admin: `/etc/codex/skills` (machine/container-wide)
   - System: bundled (`skill-creator`, `skill-installer`)
   - Config home: **CODEX_HOME** (default `~/.codex`) holds `config.toml`, `auth.json`, `history.jsonl` (<https://learn.chatgpt.com/codex/config-advanced.md>)
   - Plugin skills; optional `agents/openai.yaml` inside a skill for appearance/deps
3. **Precedence:** Codex does **not** de-duplicate by name — "If two skills share the same `name`, Codex doesn't merge them; both can appear in skill selectors."
4. **Symlinks:** "Codex supports symlinked skill folders and follows the symlink target when scanning these locations."
5. **Native enable/disable:** Yes, per skill, in `config.toml`:

```toml
[[skills.config]]
name = "my-skill"   # or: path = "/abs/path/SKILL.md"
enabled = false
```

   "If several rules match a skill, the last one wins." Plus `skills.bundled.enabled`, `skills.include_instructions`, `skills.max_context_tokens` (cap 10000; default 2% of context window). (<https://learn.chatgpt.com/docs/config-file/config-reference.md>)
6. **Other:** `AGENTS.md` (global `~/.codex/AGENTS.md`, repo `AGENTS.md`, closer file wins), memories, MCP (in `config.toml`), subagents (`[agents]`), hooks (`~/.codex/hooks.json`, `.codex/hooks.json`), project config `.codex/config.toml`, profiles.
7. **Detection:** `codex` binary (npm ```openai/codex`), `$CODEX_HOME` or `~/.codex` with `config.toml`.

---

## 3. opencode (sst / now Anomaly)

1. **Skills:** Yes — "Agent Skills … SKILL.md definitions". Docs current as of 2026-11-02; OpenCode v2 is out (docs describe v1-era paths but are the live docs). (<https://opencode.ai/docs/skills/>)
2. **Paths**
   - P: `.opencode/skills/<name>/SKILL.md`, `.claude/skills/…`, `.agents/skills/…`; walks up from CWD to the git worktree root at every level
   - U: `~/.config/opencode/skills/`, `~/.claude/skills/`, `~/.agents/skills/`
   - Env: **OPENCODE_CONFIG** (config file), **OPENCODE_CONFIG_DIR** (extra config dir searched for skills/agents/commands), OPENCODE_CONFIG_CONTENT (inline). XDG: `$XDG_CONFIG_HOME/opencode` else `~/.config/opencode`. (<https://opencode.ai/docs/config/>)
   - **Windows: UNVERIFIED.** Docs give only `~/.config/opencode`. Community reports `%APPDATA%\opencode`; a docs PR adding per-OS paths (`%APPDATA%\opencode`, `~/Library/Application Support/opencode`) was **closed unmerged** (<https://github.com/anomalyco/opencode/pull/15467>). Probe both.
3. **Precedence:** Not stated as a rule. Docs require uniqueness: "Ensure skill names are unique across all locations." **UNVERIFIED** which copy wins on collision.
4. **Symlinks:** **UNVERIFIED.**
5. **Native enable/disable:** Permission based, per skill:

```json
{ "permission": { "skill": { "*": "allow", "internal-*": "deny", "experimental-*": "ask" } } }
```

   `deny` hides the skill from the agent. Per-agent overrides (agent frontmatter or `agent.plan.permission.skill`), and `tools: { skill: false }` disables the skill tool entirely. (<https://opencode.ai/docs/skills/>)
6. **Other:** `AGENTS.md` (project) / `~/.config/opencode/AGENTS.md` (global), `CLAUDE.md` fallback, `instructions: []` globs in `opencode.json`, `agents/`, `commands/`, `plugins/`, `modes/`, `tools/`, MCP.
7. **Detection:** `opencode` binary; `~/.config/opencode/opencode.json` (or `.jsonc`); Windows likely `%APPDATA%\opencode`.

---

## 4. Google Gemini CLI

1. **Skills:** Yes — "Agent Skills let you extend Gemini CLI…". Tiers: built-in, extensions, user, workspace. (<https://geminicli.com/docs/cli/creating-skills.md>)
2. **Paths**
   - U: `~/.gemini/skills/` **or the alias** `~/.agents/skills/`
   - P: `.gemini/skills/` **or** `.agents/skills/`
   - Extensions bundle skills; built-ins ship with the CLI
   - Windows: `~/.gemini` means `%USERPROFILE%\.gemini` (docs show a PowerShell `New-Item … ".gemini\skills\code-reviewer\scripts"` example)
   - Env override: **UNVERIFIED** — no `GEMINI_HOME`-style variable in the settings/env docs.
3. **Precedence:** "lowest to highest: Built-in → Extension → User (`~/.gemini/skills`, `~/.agents/skills`) → Workspace (`.gemini/skills`, `.agents/skills`)". Same name: higher tier wins.
4. **Symlinks:** **UNVERIFIED.** (`gemini skills link <path> --scope user|workspace` registers a skill; FS symlink scanning is not documented.)
5. **Native enable/disable:** Partly. `skills.enabled` (boolean, default true) in `~/.gemini/settings.json` or `.gemini/settings.json` is a *global* switch. Per skill: `/skills disable <name>` / `/skills enable <name>` in session (plus `/skills list|reload|link`). Where the per-skill disabled set persists is **UNVERIFIED** (no settings key documented). (<https://geminicli.com/docs/cli/settings.md>, <https://geminicli.com/docs/cli/using-agent-skills.md>)
6. **Other:** `GEMINI.md` (global + project), `.gemini/settings.json`, custom commands (`.toml`), extensions, `skill-creator` meta-skill, MCP, `.geminiignore`. Workspace skills load only in **trusted** folders (`/trust`).
7. **Detection:** `gemini` binary; `~/.gemini/` (settings.json, skills/).

---

## 5. Google Antigravity

1. **Skills:** Yes — "open standard … agentskills.io". App, CLI and IDE. (<https://antigravity.google/docs/skills.md>)
2. **Paths**
   - P: `<workspace-root>/.agents/skills/<skill>/` plus `.agents/skills/` in each parent folder up to the repo root. Backward compat: `.agent/skills`.
   - U: `~/.gemini/config/skills/<skill>/` (shared by App and CLI); IDE also honours legacy `~/.gemini/antigravity/skills/`
   - CLI extra user roots: `~/.gemini/antigravity-cli/skills/`, `~/.gemini/skills/` (not read by the App)
   - Plugin skills: `~/.gemini/config/plugins/<plugin>/skills/`
   - Windows: `~/.gemini` → `%USERPROFILE%\.gemini`. Env override **UNVERIFIED**.
3. **Precedence:** **UNVERIFIED.**
4. **Symlinks:** **UNVERIFIED.**
5. **Native enable/disable:** **UNVERIFIED.** Managed through the **Customizations** menu in the agent side panel; `agy plugin` manages plugin skills. No documented per-skill config key.
6. **Other:** `AGENTS.md`, `.agent/rules/`, workflows (migrating to skills — /docs/migration/workflows-to-skills), custom subagents, MCP, plugins, sidecars, hooks.
7. **Detection:** Antigravity app (`/Applications/Antigravity.app`, `%LOCALAPPDATA%\Programs\Antigravity`), CLI `agy`, config root `~/.gemini/config` (sibling of Gemini CLI's `~/.gemini/settings.json`).

---

## 6. Cursor

1. **Skills:** Yes — "Agent Skills is an open standard… Cursor also loads skills from Claude and Codex directories." Migration tool `/migrate-to-skills` is "available in Cursor 2.4+". (<https://cursor.com/docs/skills>, <https://cursor.com/help/customization/skills>)
2. **Paths**
   - P: `.agents/skills/`, `.cursor/skills/` (incl. nested `apps/web/.cursor/skills/`, auto-scoped to that subtree)
   - U: `~/.agents/skills/`, `~/.cursor/skills/` → Windows `%USERPROFILE%\.agents\skills`, `%USERPROFILE%\.cursor\skills`
   - Compatibility roots also read: `.claude/skills/`, `.codex/skills/`, `~/.claude/skills/`, `~/.codex/skills/`
   - CLI config: `~/.cursor/cli-config.json`
3. **Precedence:** **UNVERIFIED** (locations listed without a collision rule).
4. **Symlinks:** **UNVERIFIED.**
5. **Native enable/disable:** **UNVERIFIED** as a file key. Visibility is managed in **Customize → Skills** (personal skills can be synced/published); scoping via `paths:` frontmatter globs; CLI settings in `~/.cursor/cli-config.json`.
6. **Other:** `.cursor/rules/*.mdc` (+ `.cursorrules` legacy), `AGENTS.md`, slash commands, subagents, `hooks.json`, MCP, team marketplaces.
7. **Detection:** Cursor app (`/Applications/Cursor.app`, `%LOCALAPPDATA%\Programs\cursor\Cursor.exe`), `cursor` / `cursor-agent` CLI, `~/.cursor/`.

---

## 7. Windsurf (Cognition; now shipped as Devin Desktop / "Devin Local")

1. **Skills:** Yes, from the shared Devin harness — "Skills use progressive disclosure…". Applies to the IDE agent (formerly Cascade) and Devin CLI. (<https://docs.devin.ai/desktop/cascade/skills.md> — `docs.windsurf.com/*` 301s here)
2. **Paths**
   - P: `.devin/skills/<name>/`; **also read**: `.agents/skills/`, legacy `.windsurf/skills/`
   - U: `~/.config/devin/skills/<name>/`; also `~/.agents/skills/`
   - Windows: `~/.config` → `%USERPROFILE%\.config` (docs POSIX only). Env override **UNVERIFIED**.
   - Plugin skills namespaced `/<plugin>:<skill>`
3. **Precedence:** **UNVERIFIED.**
4. **Symlinks:** **UNVERIFIED.**
5. **Native enable/disable:** **UNVERIFIED** as a file key; the **Customize** page Skills tab is the management surface.
6. **Other:** `AGENTS.md` / `AGENTS.local.md` / `AGENT.md`, `.devin/rules/*.md` with `trigger: always_on|glob|model_decision|manual`, `.devin/global_rules.md`, legacy `.windsurf/rules/*.md` + `.windsurfrules`, `.devin/mcp_config.json`, `.devin/hooks.v1.json`, plugins, subagents.
7. **Detection:** `Windsurf.app` / `%LOCALAPPDATA%\Programs\Windsurf`, legacy `~/.codeium/windsurf/`; new layout `~/.devin/` + `~/.config/devin/`; `devin` CLI.

---

## 8. Cline

1. **Skills:** Yes — shipped in **Cline 3.48.0** (<https://cline.bot/blog/cline-3-48-0-skills-and-websearch-make-cline-smarter>). Docs: <https://docs.cline.bot/customization/skills>
2. **Paths**
   - P: `.cline/skills/` (recommended), `.clinerules/skills/`, `.claude/skills/`
   - U: `~/.cline/skills/` (macOS/Linux), `C:\Users\<USERNAME>\.cline\skills\` (Windows)
3. **Precedence:** **Global beats project** on identical names — "When a global skill and project skill have the same name, the global skill takes precedence." (Unusual; most tools are the opposite.)
4. **Symlinks:** **UNVERIFIED.**
5. **Native enable/disable:** Yes in the UI — "Every skill has a toggle to enable or disable it… Skills are enabled by default when discovered." Toggle: Skills menu (scale icon → Skills tab). Whether it persists to a file (vs extension globalState) is **UNVERIFIED**.
6. **Other:** `.clinerules/` (+ `.clinerules/workflows/`), `.clineignore`, rules, hooks, MCP, plugins, subagents/agent teams.
7. **Detection:** VS Code extension `saoudrizwan.claude-dev`, Cline Desktop/CLI, `~/.cline/`, `.cline/` in repo.

---

## 9. Roo Code and Kilo Code (same lineage, different paths, same spec)

### Roo Code
- **Paths:** U: `~/.roo/skills/` (Roo-specific, higher priority) and `~/.agents/skills/`; Windows `%USERPROFILE%\.roo\skills`, `%USERPROFILE%\.agents\skills`. P: `.roo/skills/`, `.agents/skills/`. Mode-scoped dirs `skills-{mode}/` in both roots (e.g. `~/.roo/skills-code/`, `.roo/skills-architect/`, `.agents/skills-code/`).
- **Precedence (documented, 8 levels):** project `.roo` mode-specific > project `.roo` generic > project `.agents` mode-specific > project `.agents` generic > global `.roo` mode-specific > global `.roo` generic > global `.agents` mode-specific > global `.agents` generic. Project always beats global; `.roo` beats `.agents` at the same level.
- **Symlinks:** explicitly supported (`ln -s /shared/company-skills ~/.roo/skills/company-skills`).
- **Enable/disable:** **UNVERIFIED** (no documented per-skill key or toggle).
- **Other:** `.roo/rules/`, `.roo/rules-{mode}/`, custom modes, `.rooignore`, MCP, workflows, slash commands.
- Source: <https://roocodeinc.github.io/Roo-Code/features/skills/>

### Kilo Code
- **Paths:** U: `~/.kilo/skills/` (Windows `\Users\<user>\.kilo\skills\`) and `~/.agents/skills/`; P: `.kilo/skills/`, `.agents/skills/`. Compatibility: `~/.claude/skills/` + `.claude/skills/` **only when "Claude Code Compatibility" is enabled**.
- **Extra roots:** `skills.paths` (absolute, `~/`, or project-relative) and `skills.urls` (remote `index.json` manifest) in `kilo.jsonc` — global `~/.config/kilo/kilo.jsonc`; project-declared external paths stay untrusted.
- **Precedence:** project (`.kilo/skills/`) > global (`~/.kilo/skills/`).
- **Enable/disable:** **UNVERIFIED** per skill (`/reload` exists).
- Source: <https://kilo.ai/docs/features/skills>

---

## 10. GitHub Copilot (cloud agent, CLI, VS Code agent mode)

1. **Skills:** Yes, and validated against the spec: `gh skill publish` "validate your skills against the Agent Skills specification". Works with cloud agent, code review, Copilot CLI, Copilot app, and VS Code agent mode. (<https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills>)
2. **Paths**
   - P: `.github/skills/`, `.claude/skills/`, `.agents/skills/`
   - U: `~/.copilot/skills/`, `~/.agents/skills/`
   - `gh skill install … --scope user|project --agent claude-code` writes "into the correct directory for your agent host"
   - VS Code: "VS Code looks for skills in `.agents/skills/` by default" (<https://agentskills.io/llms-full.txt>)
3. **Precedence:** **UNVERIFIED.**
4. **Symlinks:** **UNVERIFIED.**
5. **Native enable/disable:** **UNVERIFIED.** CLI user config `~/.copilot/settings.json` (JSONC) and `~/.copilot/config.json` (app-managed); no documented per-skill enable key.
6. **Other:** `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, `~/.copilot/copilot-instructions.md` + `~/.copilot/instructions/`, `.github/prompts/*.prompt.md`, custom agents (`.github/agents/`, `~/.copilot/agents/`), hooks (`~/.copilot/hooks/`), `mcp-config.json` + `.vscode/mcp.json`, plugins.
7. **Detection:** `copilot` CLI + `~/.copilot/` (override **COPILOT_HOME**; cache **COPILOT_CACHE_HOME** → `%LOCALAPPDATA%\copilot`); VS Code ext `GitHub.copilot`; `gh` 2.90+ has `gh skill` (public preview). (<https://raw.githubusercontent.com/github/docs/main/content/copilot/reference/copilot-cli-reference/cli-config-dir-reference.md>)

---

## 11. Amp (Sourcegraph)

1. **Skills:** Yes, with the most complete documented precedence model and hosted skill repositories. (<https://ampcode.com/docs/customize/skills>)
2. **Paths**
   - P: `.agents/skills/` in the project and searched parent dirs; also `.claude/skills/` in those dirs
   - U: `~/.config/agents/skills/`, `~/.agents/skills/`, `~/.config/amp/skills/`, `~/.claude/skills/`, `~/.claude/plugins/cache/`, plus `amp.skills.path` entries, personal repo, workspace repo
   - Windows: `~/.config` → `%USERPROFILE%\.config` (not separately documented)
   - `amp skill add <source> --global` installs to `~/.config/agents/skills/`
3. **Precedence (documented, first match on frontmatter `name` wins):** `~/.config/agents/skills` → `~/.agents/skills` → `~/.config/amp/skills` → project `.agents/skills` (and parents) → project `.claude/skills` → `~/.claude/skills` → `~/.claude/plugins/cache` → `amp.skills.path` in order → personal repo → workspace repo → official Amp skills. Local masks repository; personal masks workspace. Recursion up to 5 levels below each root.
4. **Symlinks:** **UNVERIFIED** (recursive scan documented; symlink handling not mentioned).
5. **Native enable/disable:** Partly. `amp.skills.disableClaudeCodeSkills: true` (skip Claude-compatible roots) and `amp.skills.disableGlobalAgentsSkills: true` (skip `~/.config/agents/skills` + `~/.agents/skills`). No per-skill boolean documented → **UNVERIFIED** for per-skill.
6. **Other:** `AGENTS.md`, settings (`amp.skills.*`), permissions, plugins (bundle skills as `plugin:skill`), MCP.
7. **Detection:** `amp` CLI on PATH; `~/.config/amp/`.

---

## 12. Factory Droid

1. **Skills:** Yes, first-class, with a status model (Enabled/Disabled/Overridden/Invalid) and `/create-skill`. (<https://docs.factory.com/cli/configuration/skills>)
2. **Paths**
   - P: `<repo>/.factory/skills/<name>/SKILL.md`; folder-specific `<repo>/<area>/.factory/skills/…`
   - U: `~/.factory/skills/<name>/SKILL.md`
   - Compat: `<repo>/.agents/skills/**/SKILL.md`, `<repo>/.agent/skills/**`; `~/.agents/skills/**`, `~/.agent/skills/**`
   - Mission `{missionDir}/skills/`; automations `~/.factory/automations/<automation>/skills/`; plugin `skills/` (variable `${DROID_PLUGIN_ROOT}` expands to the plugin path); built-ins
   - Recursive scan: first directory containing `SKILL.md` is the skill dir
3. **Precedence:** folder-specific/project → project plugin → compat → … (doc list continues; lower levels **UNVERIFIED**).
4. **Symlinks:** **UNVERIFIED.**
5. **Native enable/disable:** Yes:

```json
// ~/.factory/settings.json   |   <project>/.factory/settings.json
{ "disabledSkills": ["deploy-production", "summarize-diff"] }
```

   "User and project arrays are combined, so a disable at either level wins." Also `enabled: false` in SKILL.md frontmatter; the settings ledger records which source disabled a skill.
6. **Other:** `AGENTS.md`, custom slash commands, subagents, MCP, hooks, plugins, missions/automations.
7. **Detection:** `droid` binary; `~/.factory/` (`settings.json`, `skills/`).

---

## 13. Kiro (AWS)

1. **Skills:** Yes — "Skills are portable instruction packages that follow the open Agent Skills standard." IDE, CLI, web, mobile. (<https://kiro.dev/docs/skills.md>)
2. **Paths**
   - P: `.kiro/skills/`
   - U: `~/.kiro/skills/` (not available on Kiro Web; Web uses `.kiro/skills/` + Agent Config → Skills)
   - Windows: `%USERPROFILE%\.kiro\skills` (docs POSIX only)
   - Custom agents opt in: `resources: ["skill://.kiro/skills/*/SKILL.md", "skill://~/.kiro/skills/*/SKILL.md"]`
   - Env override: **UNVERIFIED**
3. **Precedence:** "When skills share the same name, workspace skills take priority over global skills."
4. **Symlinks:** **UNVERIFIED.**
5. **Native enable/disable:** **UNVERIFIED** (managed via "Agent Steering & Skills" panel / Agent Config UI; no documented config key).
6. **Other:** `.kiro/steering/*.md`, `.kiro/specs/`, hooks, MCP, custom agents/subagents, powers.
7. **Detection:** Kiro IDE (`/Applications/Kiro.app`, `%LOCALAPPDATA%\Programs\Kiro`), `kiro-cli` on PATH (`~/.local/bin` for script installs; Homebrew `kiro-cli`), `~/.kiro/`.

---

## 14. Aider

1. **Skills:** **No.** No `SKILL.md` support in the docs (checked <https://aider.chat/docs/usage/conventions.html> and the config docs). Nearest equivalent: read-only context files.
2. **Paths:** No skill dirs. `CONVENTIONS.md` is added via `--read CONVENTIONS.md` or `read:` in `.aider.conf.yml`. Config lookup: home directory, git repo root, current directory. (<https://aider.chat/docs/config/aider_conf.html>)
3. **Precedence:** n/a (all `read:` files load).
4. **Symlinks:** n/a.
5. **Enable/disable:** n/a — remove the `read:` entry or the file.
6. **Other:** `CONVENTIONS.md`, `.aider.conf.yml`, `.aiderignore`, `--read` files, repo map, no MCP.
7. **Detection:** `aider` binary (Python package `aider-chat`), `~/.aider.conf.yml`, repo `.aider.conf.yml`.

---

## 15. Continue

1. **Skills:** **Not confirmed — assume No.** No skills page in the docs index; `https://docs.continue.dev/llms.txt` returned 404. **UNVERIFIED / likely unsupported.**
2. **Paths:** No skill dirs found. Rules: `.continue/rules/*.md` (project), `~/.continue/rules/` (global); config `~/.continue/config.yaml`.
3. **Precedence:** n/a.
4. **Symlinks:** n/a.
5. **Enable/disable:** n/a (rules can be globbed/scoped in frontmatter).
6. **Other:** `.continue/rules/`, `config.yaml` (models, MCP servers, prompts, context providers), `.continue/prompts/`, ````-context providers.
7. **Detection:** VS Code/JetBrains extension `continue.continue`; `cn` CLI; `~/.continue/`.

---

## 16. Zed

1. **Skills:** Yes — "a skill is a folder containing a `SKILL.md` file"; the agent sees a catalog and calls the `skill` tool; `/create-skill` built in; skills.sh registry integration. (<https://zed.dev/docs/ai/skills.md>)
2. **Paths**
   - U: `~/.agents/skills/` → Windows `%USERPROFILE%\.agents\skills`
   - P: `<project>/.agents/skills/`
   - No `.zed/skills` root documented.
3. **Precedence:** **UNVERIFIED.**
4. **Symlinks:** **UNVERIFIED.**
5. **Native enable/disable:** UI-managed. Settings page **AI → Skills** (`agent.skills`), User and Project tabs; per skill: Copy Share Link / Open / Delete. `disable-model-invocation: true` stops autonomous invocation; per-skill **Tool Permissions** pre-approve the `skill` tool. No documented `enabled: false` key → **UNVERIFIED** for a file-level toggle.
6. **Other:** `.rules` / `agent.rules`, `AGENTS.md`, `.zed/settings.json` (`~/.config/zed/settings.json`), MCP (`context_servers`), custom profiles, `zed://skill?data=` share links.
7. **Detection:** `zed` CLI (`/Applications/Zed.app`, `%LOCALAPPDATA%\Programs\Zed`), `~/.config/zed/`.

---

## 17. Crush (Charm)

1. **Skills:** Yes — "Crush supports the Agent Skills open standard". (<https://github.com/charmbracelet/crush> README; feature PR <https://github.com/charmbracelet/crush/pull/1690>)
2. **Paths** (README's exact list)
   - U: `$CRUSH_SKILLS_DIR`; `$XDG_CONFIG_HOME/agents/skills` or `~/.config/agents/skills`; `$XDG_CONFIG_HOME/crush/skills` or `~/.config/crush/skills`; `~/.agents/skills`; `~/.claude/skills`
   - U on Windows also: `%LOCALAPPDATA%\agents\skills`, `%LOCALAPPDATA%\crush\skills`
   - Extra: `options.skills_paths`, or `option skill-path "$HOME/squid-skills" "./other-skills"`
   - P: `.agents/skills`, `.crush/skills`, `.claude/skills`, `.cursor/skills`
3. **Precedence:** **UNVERIFIED** (list order implies but does not state a winner).
4. **Symlinks:** **UNVERIFIED.**
5. **Native enable/disable:** Yes: `option disable-skill <name>` — "Disabled skills are hidden from the agent, including builtin skills and skills discovered from…". Also `user-invocable: true` / `disable-model-invocation: true` frontmatter.
6. **Other:** `CRUSH.md` / `AGENTS.md` (`~/.config/crush/CRUSH.md`, `~/.config/AGENTS.md`), `.crushrc` / `~/.config/crush/crushrc` (env `CRUSH_GLOBAL_CONFIG`), `.crushignore`, MCP, themes.
7. **Detection:** `crush` binary (brew/winget/npm/go), `~/.config/crush/` (Windows `%USERPROFILE%\.config\crush`).

---

## 18. Enable/disable: four implementation strategies

| Strategy | Works for | Notes |
|---|---|---|
| Write the vendor's own toggle | Claude Code (`skillOverrides`), Codex (`[[skills.config]]`), Factory (`disabledSkills`), Crush (`option disable-skill`), opencode (`permission.skill`), Amp (`disableClaudeCodeSkills` / `disableGlobalAgentsSkills`), Gemini (`skills.enabled`, global only) | Cleanest; must edit the right file per tool and preserve JSONC/TOML/YAML formatting. |
| Permission / allow-list scoping | opencode, Zed tool permissions, Copilot `allowed-tools` | "Disabled" = denied. |
| Filesystem move/rename | Any harness | Move `~/.agents/skills/<name>` → store/disabled/<name>; breaks other tools sharing that dir. |
| Symlink / junction fan-out | Claude Code, Codex, Roo (verified); others **UNVERIFIED** | One canonical store linked into each tool's roots. |

**Verified symlink-following:** Claude Code, Codex, Roo Code. Everything else: unknown.

---

## 19. One on-disk format for many harnesses?

**Yes.** All accept a directory `<name>/SKILL.md` with `name` + `description` frontmatter, and many accept the *same roots*:

| Root | Harnesses that read it (verified) |
|---|---|
| `<repo>/.agents/skills/` and `~/.agents/skills/` | Codex, opencode, Gemini CLI, Antigravity, Cursor, Copilot, Amp, Zed, Crush, Roo Code, Kilo Code, Factory (compat). **Not Claude Code.** |
| `.claude/skills/` and `~/.claude/skills/` | Claude Code, opencode, Cursor, Copilot, Amp, Crush, Kilo (opt-in), Copilot. **Not Roo, not Factory, not Codex.** |
| `.github/skills/` | Copilot |
| tool-native | `~/.claude`, `~/.cursor`, `~/.gemini`, `~/.kiro`, `~/.roo`, `~/.kilo`, `~/.factory`, `~/.cline`, `~/.config/opencode`, `~/.config/crush`, `~/.config/devin`, `~/.copilot` |

**Officially state Agent Skills / agentskills.io compliance:** Claude Code, Codex (ChatGPT), opencode, Gemini CLI, Antigravity, Cursor, Cline, Copilot (GH docs; `gh skill publish` validates against the spec), Amp, Factory Droid, Kiro, Kilo Code, Roo Code, Crush, Windsurf/Devin. **Zed:** same format and roots, but its docs do not name the standard (partly unverified). **Not supported:** Aider, Continue.

**Implication for the app:** keep one canonical `SKILL.md` store, fan out to `~/.agents/skills` (largest coverage) plus per-tool native roots for tools that ignore it: Claude Code (`~/.claude/skills`), Cline (`~/.cline/skills`), Kiro (`~/.kiro/skills`), Factory (`~/.factory/skills`), Kilo (`~/.kilo/skills`), opencode (`~/.config/opencode/skills`), Crush (`~/.config/crush/skills`). Prefer symlink/junction fan-out only where symlink support is documented; copy otherwise.

---

## 20. Detection cheat-sheet

| Harness | Binary / app | Probe |
|---|---|---|
| Claude Code | `claude` (`~/.local/bin/claude`, `%USERPROFILE%\.local\bin\claude.exe`), VS Code ext | `~/.claude/`, `~/.claude.json`, `$CLAUDE_CONFIG_DIR` |
| Codex CLI | `codex` | `$CODEX_HOME` / `~/.codex/config.toml`, `~/.agents/skills` |
| opencode | `opencode` | `~/.config/opencode/opencode.json`, `$OPENCODE_CONFIG_DIR`, `%APPDATA%\opencode` (unverified) |
| Gemini CLI | `gemini` | `~/.gemini/settings.json`, `~/.gemini/skills/` |
| Antigravity | `agy` CLI, Antigravity.app | `~/.gemini/config/`, `~/.gemini/antigravity-cli/` |
| Cursor | Cursor.app, `cursor`, `cursor-agent` | `~/.cursor/` (`cli-config.json`), `~/.cursor/skills/` |
| Windsurf/Devin | Windsurf.app, `devin` CLI | `~/.devin/`, `~/.config/devin/`, `~/.codeium/windsurf/` (legacy) |
| Cline | VS Code ext `saoudrizwan.claude-dev` | `~/.cline/` |
| Roo Code | VS Code ext `rooveterinaryinc.roo-cline` | `~/.roo/` |
| Kilo Code | VS Code ext `kilocode.kilo-code` | `~/.kilo/`, `~/.config/kilo/kilo.jsonc` |
| Copilot | `copilot` CLI, ext `GitHub.copilot`, `gh skill` | `~/.copilot/` (`settings.json`, `skills/`), `$COPILOT_HOME` |
| Amp | `amp` | `~/.config/amp/`, `~/.config/agents/` |
| Factory Droid | `droid` | `~/.factory/` (`settings.json`, `skills/`) |
| Kiro | Kiro.app, `kiro-cli` | `~/.kiro/` (`skills/`, `steering/`) |
| Aider | `aider` (pip) | `~/.aider.conf.yml` |
| Continue | ext `continue.continue`, `cn` | `~/.continue/config.yaml` |
| Zed | `zed`, Zed.app | `~/.config/zed/settings.json` |
| Crush | `crush` | `~/.config/crush/` (Windows `%LOCALAPPDATA%\crush`) |

Windows expansions assume the standard `%USERPROFILE%`; vendors usually write POSIX `~` only.

---

## 21. What could NOT be confirmed

1. **Per-skill disable persistence** for Gemini CLI (`/skills disable`), Cline (toggle), Roo Code, Kilo Code, Cursor, Copilot (CLI + VS Code), Kiro, Antigravity, Windsurf/Devin, Zed (`agent.skills` schema). Only Claude Code, Codex, Factory, Crush, opencode and Amp document a writable per-skill switch.
2. **Same-name precedence** for opencode, Cursor, Copilot, Antigravity, Windsurf/Devin, Crush, Zed. (Documented for Claude Code, Codex (no merge), Gemini, Roo, Kilo, Kiro, Cline, Amp, Factory (partly).)
3. **Symlink/junction following** for opencode, Gemini CLI, Antigravity, Cursor, Copilot, Amp, Factory, Kiro, Crush, Zed, Cline, Kilo, Windsurf/Devin. Only Claude Code, Codex and Roo document it positively.
4. **Windows path variants** for opencode (`%APPDATA%\opencode` is community-reported; docs PR adding it was closed unmerged), Windsurf/Devin, Kiro, Zed — docs give POSIX forms only.
5. **`~/.codex/skills`**: widely repeated in blog posts, but current official Codex docs use `$HOME/.agents/skills`. Treat `~/.codex/skills` as legacy/unverified.
6. **Versions when skills support landed** for Codex, Gemini CLI, opencode, Kiro, Amp, Factory, Antigravity, Windsurf/Devin, Crush, Zed. Only Cursor 2.4+ (migration tool) and Cline 3.48.0 are documented.
7. **Continue**: no evidence of skills support at all (no docs page; `/llms.txt` 404). Treated as unsupported.
8. **Aider**: no skills support; `CONVENTIONS.md` + `--read` only.
9. Claude Code skills **launch date** not re-verified from a primary page in this pass — the docs do not state it, so no date is asserted.
