# Desktop-stack constraints for a local-first "skill manager"

Research date: **2026-11-05** (Asia/Jakarta). Environment used for hands-on checks: Windows 11
(build 26100), PowerShell 5.1, Node **v24.21.0**, user **non-elevated**, Developer Mode **on**
(`HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock\AllowDevelopmentWithoutDevLicense = 1`).

Every claim below carries a source URL. Claims I could not tie to a primary source are marked
**UNVERIFIED**. A small number of facts are **measured on the machine above** — those are labelled
**MEASURED** and are reproducible from the commands/quotes given.

Companion note (format, paths, registries, prior art): `./skills-ecosystem-and-prior-art.md`.
This file covers the *stack* constraints: link semantics, traversal by language, UI shell, watching,
security, storage, and CLI discovery.

---

## 0. The 12 facts that actually shape the design

| # | Fact | Consequence |
| - | - | - |
| 1 | A **junction needs no privilege**; a **directory symlink needs SeCreateSymbolicLinkPrivilege**, waived only when Developer Mode is on. | Default to junctions on Windows; treat symlink failure as an expected, recoverable state. |
| 2 | Node reports **junctions and dir-symlinks identically** through `readdir({withFileTypes})` / `lstat`: `isSymbolicLink() === true`, `isDirectory() === false`. **MEASURED**, matches libuv source. | Never build a tree walker on `dirent.isDirectory()`. Use `stat` (follows) to detect "is a directory here". |
| 3 | A dangling junction/symlink still `lstat`s fine but every *follow* call fails `ENOENT` (`stat`, `realpath`, `readdir`). `fs.access` still returns OK. **MEASURED** | `fs.access` is useless as an existence probe for links; use `lstat` + `realpath`. |
| 4 | Junction targets are **absolute paths resolved live**: renaming the target breaks the link, renaming it back restores it. **MEASURED** | Never assume a link is dead permanently; re-check on focus/refresh. |
| 5 | Go's `fs.WalkDir` **does not follow** symlinks found in directories (only a symlinked *root*). Rust `walkdir` defaults `follow_links(false)`. Python `os.walk` defaults `followlinks=False`. | Symlinking *inside* a skill folder silently hides files from those tools. Symlink the *skill folder itself* instead. |
| 6 | Claude Code **explicitly supports** a skill folder being a symlink and de-duplicates by target. | "Symlink farm" is a sanctioned strategy for at least one major harness — not a hack. |
| 7 | Tauri requires **Rust on the dev machine only**; end users need WebView2 (preinstalled on Win10 1803+). Tauri's own claim: apps "as little as 600KB". | Two very different dev-cost vs install-size trade-offs. Electron ships Chromium+Node. |
| 8 | Tauri's updater **cannot run unsigned** ("This cannot be disabled"); Windows signing is effectively mandatory (Smart App Control), macOS needs a **paid** Apple Developer account to notarize. | Budget for certificates + CI signing secrets from day one. |
| 9 | `ReadDirectoryChangesW` **silently discards its buffer** on overflow and returns success with 0 bytes. FSEvents is **per-directory and coalesced**. | The watcher must be a *hint* that triggers a debounced full rescan, never a delta log. |
| 10 | `node:sqlite` is still **Stability 1.2 (Release candidate)** in Node 24; `better-sqlite3` is a native module requiring an Electron ABI rebuild. | Electron: `better-sqlite3` + `@electron/rebuild`; Tauri: `tauri-plugin-sql`; Node 24 sidecar: `node:sqlite` acceptable but not frozen. |
| 11 | `server.listen(port)` with no host binds <<BT>::`/`0.0.0.0` — i.e. **the whole network**. | Any local HTTP API must pass `127.0.0.1` explicitly. |
| 12 | GUI apps do **not** get a shell's `PATH`. macOS composes `PATH` via `path_helper`, "intended only for use by the shell profile". | Resolve CLIs by probing known install dirs, not by trusting `process.env.PATH`. |

---

## 1. Windows links: symlink vs junction vs hardlink

### 1.1 What each thing is

| Kind | Targets | Cross-volume | Privilege | Source |
| - | - | - | - | - |
| Hard link | **files only**, same volume | no | none documented | https://learn.microsoft.com/en-us/windows/win32/fileio/hard-links-and-junctions |
| Junction ("soft link") | **directories only**; "can also link directories located on different local volumes on the same computer"; cannot target a mapped network drive | **yes (local volumes)** | none documented; created as a reparse point | https://learn.microsoft.com/en-us/windows/win32/fileio/hard-links-and-junctions |
| Symbolic link | files or directories, absolute or relative, may point at **UNC** paths | yes (absolute links) | `SeCreateSymbolicLinkPrivilege` **unless** Developer Mode + `SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE` | https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createsymboliclinkw |

Verbatim from the junction doc: "A junction can also link directories located on different local volumes on
the same computer… The following references are permitted as junctions: `C:\dira` linked to
`C:\dirb\dirc`, `C:\dirx` linked to `D:\diry`", while "aren't permitted because
they reference mapped network volumes": `C:\dir1` linked to `Z:\dir2`.

Reparse-point limits that matter at scale: the target directory **must be empty** when the reparse point is
established, reparse data is capped at 16 KB, and there is **a limit of 63 reparse points on any given
path** (31 if the target is a fully-qualified path) — https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-points.
Not an issue for `~/skills` depth, but relevant if links get chained.

### 1.2 Privileges and Developer Mode

- `CreateSymbolicLinkW` flag table: `0x2 SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE` —
  "Specify this flag to allow creation of symbolic links when the process is not elevated. **Developer Mode
  must first be enabled on the machine before this option will function.**"
  https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createsymboliclinkw
- Microsoft's own announcement: "Starting with Windows 10 Insiders build 14972, symlinks can be created
  without needing to elevate the console as administrator… in Windows 10 Creators Update, a user (with admin
  rights) can first enable Developer Mode, and then **any user on the machine** can run the mklink command
  without elevating." https://blogs.windows.com/windowsdeveloper/2016/12/02/symlinks-windows-10/
- Enabling Developer Mode itself "requires administrator access" and may be disabled on org-managed devices
  — https://learn.microsoft.com/en-us/windows/apps/get-started/enable-your-device-for-development

**Node's behaviour is not "try junction, else symlink" — it does whatever you ask.** In libuv on Windows:

```c
static int uv__file_symlink_usermode_flag = SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE;
...
if (req->fs.info.file_flags & UV_FS_SYMLINK_JUNCTION) { fs__create_junction(req, pathw, new_pathw); return; }
if (req->fs.info.file_flags & UV_FS_SYMLINK_DIR)
  flags = SYMBOLIC_LINK_FLAG_DIRECTORY | uv__file_symlink_usermode_flag;
else
  flags = uv__file_symlink_usermode_flag;
if (CreateSymbolicLinkW(new_pathw, pathw, flags)) { ... }
/* on ERROR_INVALID_PARAMETER: clear the flag and retry (pre-14972 systems) */
```
— https://github.com/libuv/libuv/blob/v1.x/src/win/fs.c

So Node **always** asks for unprivileged creation, degrades to the privileged call on ancient builds, and
creates junctions through `FSCTL_SET_REPARSE_POINT` — a completely different code path that never
touches symlink privileges (same file).

Node's documented surface, `fs.symlink(target, path[, type])`: "The `type` argument is only
available on Windows and ignored on other platforms. It can be set to <<BT>'dir'`, <<BT>'file'`, or
<<BT>'junction'`. If `type` is `null`, Node.js will autodetect target type and use
<<BT>'file'` or <<BT>'dir'`. **If the target does not exist, <<BT>'file'` will be used. Windows
junction points require the destination path to be absolute. When using <<BT>'junction'`, the target
argument will automatically be normalized to absolute path. Junction points on NTFS volumes can only point to
directories.**" — https://nodejs.org/api/fs.html#fssymlinktarget-path-type-callback

### 1.3 MEASURED: non-admin, Developer Mode ON

All four link kinds created by a plain (non-elevated) shell:

```
mklink /J  junc      -> Junction created
mklink /D  symd      -> symbolic link created
mklink     symf      -> symbolic link created
mklink /H  hard.txt  -> Hardlink created
```

What Node then reports:

| Entry | `dirent.isDirectory()` | `dirent.isSymbolicLink()` | `lstat` | `realpath` |
| - | - | - | - | - |
| junction to dir | **false** | **true** | symlink | resolves to target |
| symlink to dir | false | true | symlink | resolves to target |
| real directory | true | false | dir | itself |
| hard link to file | false | false (`isFile()`) | file | file |

Not a Node bug: libuv's Windows `readdir` assigns `UV__DT_LINK` to anything carrying
`FILE_ATTRIBUTE_REPARSE_POINT` **before** it checks `FILE_ATTRIBUTE_DIRECTORY`
(https://github.com/libuv/libuv/blob/v1.x/src/win/fs.c), and junctions are reparse points.

### 1.4 MEASURED: target deleted, moved, re-created

Junction `junc -> target`, probed at each step:

| State | `statSync` | `lstatSync` | `realpathSync` | `readdirSync` | `accessSync` |
| - | - | - | - | - | - |
| healthy | OK | OK | OK | OK | OK |
| target deleted | **ENOENT** | OK | ENOENT | ENOENT | **OK** |
| target re-created | OK | OK | OK | OK | OK |
| target renamed away | ENOENT | OK | ENOENT | ENOENT | OK |
| target renamed back | OK | OK | OK | OK | OK |

Two rules fall out:

1. `lstat` is the only reliable "does the link exist" probe; `access` returns OK for
   dangling links and is anyway documented as a poor existence check —
   https://nodejs.org/api/fs.html#fsaccesspath-mode-callback.
2. A link is not "broken forever": junction targets are absolute paths resolved at access time, so pointing
   the target back restores the link with no re-link step. This matches the documented semantics that
   "Symbolic links can point to a non-existent target. When creating a symbolic link, the operating system
   does not check to see if the target exists. If an application tries to open a non-existent target,
   `ERROR_FILE_NOT_FOUND` is returned."
   — https://learn.microsoft.com/en-us/windows/win32/fileio/symbolic-link-programming-considerations
   (and `mklink /J` likewise creates a junction to a path that does not exist — **MEASURED**).

Cross-drive junction: **not testable here** (only `C:\` exists on this machine). The Microsoft doc
states it is allowed between local volumes; treat the `D:\` case as documented-but-unverified in this lab.

### 1.5 What a failed symlink actually raises

libuv's Win32-to-errno table has **no `ERROR_PRIVILEGE_NOT_HELD` entry**, and its `default:`
arm returns `UV_UNKNOWN` — https://github.com/libuv/libuv/blob/v1.x/src/win/error.c. So with Developer
Mode **off** and no elevation, expect `fs.symlink` to throw either an access-denied-derived `EPERM`
or `UNKNOWN` depending on the failure path. **UNVERIFIED** (cannot toggle Developer Mode without
admin); the safe implementation keys off *any* throw, falls back to junction/copy, and logs
`err.code` + `err.syscall`.

---

## 2. How well do non-Node CLIs survive a symlinked/junctioned skill directory?

The distinction that matters: **link at the root of the traversal** (a skill *folder* that is a link) versus
**link inside the traversal** (a *file or subfolder inside* a skill that is a link).

| Toolchain | Root is a link | Nested link inside the tree | Source |
| - | - | - | - |
| **Go** `io/fs.WalkDir` / `filepath.Walk` | walked ("if root itself is a symbolic link, its target will be walked") | **skipped** — "WalkDir does not follow symbolic links found in directories" | https://github.com/golang/go/blob/master/src/io/fs/walk.go |
| **Rust** `walkdir` | walked | skipped — "whether to follow symbolic links (**default off**)" | https://github.com/BurntSushi/walkdir/blob/master/src/lib.rs |
| **Python** `os.walk` | walked | skipped — "By default, walk will not walk down into symbolic links that resolve to directories" | https://docs.python.org/3/library/os.html#os.walk |
| **Python** `glob('**')` | n/a | **followed** — `**` "will match any files and zero or more directories, subdirectories and **symbolic links to directories**" | https://docs.python.org/3/library/glob.html |
| **Node** `glob` (isaacs) | walked | partly followed — "`follow` Follow symlinked directories when expanding `**` patterns… By default, a `**` in a pattern will follow **1** symbolic link if it is not the first item in the pattern" | https://github.com/isaacs/node-glob#readme |
| **Node** `fs.glob` (built-in) | walked | opt-in `followSymlinks`, with cycle detection | https://nodejs.org/api/fs.html#fspromisesglobpattern-options |
| **Node** naive `readdir`+`isDirectory()` | **broken on Windows for junctions** (§1.3) | broken for links | measured + libuv source |

Implications:

- **Farming whole skill folders is safe; farming individual files is not.** A manager that "shares" one
  `SKILL.md` or one `scripts/` dir across agents by symlinking the *file* will invisibly break
  Go and Rust consumers (and `os.walk`-based Python ones).
- **Claude Code is link-aware at the folder level by design**: "a <<BT><skill-name><` entry in the
  enterprise, personal, or project location **can be a symlink to a directory elsewhere on disk**. Claude Code
  reads `SKILL.md` from the target and **loads the skill once even if several locations point at the
  same target**." — https://code.claude.com/docs/en/skills.md
- **`fs.realpath` is the portable identity key.** Both junctions and symlinks resolved
  (`realpathSync` returned the target in every MEASURED case), so realpath → dedupe is the correct way
  to avoid double-listing one skill through two agent directories. Do **not** use `lstat().ino` —
  Node inode numbers on Windows are not stable identifiers **UNVERIFIED**.
- Cycle risk: `fs.glob` documents cycle detection
  (https://nodejs.org/api/fs.html#fspromisesglobpattern-options); hand-rolled walkers need a visited-set keyed
  by realpath, because Go/Rust/Python defaults will not save you once following is enabled.

---

## 3. Tauri v2 vs Electron (2026) for a local-first skill manager

### 3.1 What each one is

- **Electron**: "lets you write cross-platform desktop applications using JavaScript, HTML and CSS. It is
  based on **Node.js and Chromium**" — https://github.com/electron/electron#readme — renderer and runtime ship
  inside the app.
- **Tauri**: Rust core + the **OS webview**. Windows: "Tauri uses Microsoft Edge WebView2 to render content
  on Windows"; macOS uses the Xcode toolchain — https://v2.tauri.app/start/prerequisites/. Sizing claim: "By
  using the OS's native web renderer, the size of a Tauri app can be little as **600KB**" —
  https://v2.tauri.app/ (vendor claim about the binary; real installers are larger — **UNVERIFIED**).

Concrete installed-size numbers for either stack are **UNVERIFIED** here: neither project publishes a measured
figure, and neither app was built in this session.

### 3.2 Rust on the developer machine (not the user's)

Verbatim: "Tauri is built with Rust and **requires it for development**."
— https://v2.tauri.app/start/prerequisites/. The same page lists Windows prerequisites as Microsoft C++ Build
Tools ("Desktop development with C++") **plus** WebView2, and macOS as Xcode or `xcode-select --install`
plus `rustup`.

- **Developer machine**: Rust (rustup), MSVC build tools on Windows, Xcode CLT on macOS.
- **End-user machine**: no Rust. The documented runtime dependency is **WebView2**, which "is already installed
  on Windows 10 (from version 1803 onward) and later versions of Windows", so in practice none on modern
  Windows; macOS ships WKWebView as part of the OS (inferred — Tauri's "OS's native web renderer" claim).

### 3.3 Auto-update

| | Tauri | Electron |
| - | - | - |
| Mechanism | `@tauri-apps/plugin-updater` + `createUpdaterArtifacts: true`; static JSON endpoint or dynamic server | built-in Squirrel + `autoUpdater`, or electron-builder's `electron-updater` |
| Signing | **mandatory**: "Tauri's updater needs a signature to verify that the update is from a trusted source. **This cannot be disabled.**" Public key in `tauri.conf.json`, private key via `TAURI_SIGNING_PRIVATE_KEY` (+ optional password) | update metadata must be served over HTTPS; app-level signing is separate |
| Source | https://v2.tauri.app/plugin/updater/ | https://www.electronjs.org/docs/latest/tutorial/updates |

Tauri gives a stricter, simpler trust model (a minisign keypair you must not lose — "if you lose this key you
will NOT be able to publish new versions"), Electron gives fewer moving parts if you already ship Node.

### 3.4 Code signing, Windows

- "Code signing is required on Windows to allow your application to be listed in the Microsoft Store and to
  prevent a SmartScreen warning… It is **not** required to execute your application on Windows, as long as your
  end user is okay with ignoring the SmartScreen warning. The exception is **Windows 11 with Smart App Control
  turned on: it blocks unknown unsigned apps even if they weren't downloaded from the browser**, and users can't
  allow a single app, only turn Smart App Control off entirely." — https://v2.tauri.app/distribute/sign/windows/
- Same page: since 2024 an **EV certificate no longer grants instant SmartScreen reputation**; OV and EV build
  reputation the same way (Microsoft policy page linked from it:
  https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).
- Electron states the same reality bluntly: "Both Windows and macOS prevent users from running unsigned
  applications" — https://www.electronjs.org/docs/latest/tutorial/code-signing
- Practical consequence: OV certificates issued after **2023-06-01** require a hardware token/HSM, so CI signing
  means Azure Trusted Signing or a cloud HSM. Tauri documents this boundary ("This guide only applies to OV code
  signing certificates acquired before June 1st 2023") — https://v2.tauri.app/distribute/sign/windows/.

### 3.5 Code signing, macOS

- Apple Developer account required; "either paid (99$ per year) or on the free plan (only for testing and
  development purposes)… **when using a free Apple Developer account, you will not be able to notarize your
  application**" — https://v2.tauri.app/distribute/sign/macos/
- Signing needs a Mac ("You also need an Apple device where you perform the code signing"); certificate types
  `Developer ID Application` (outside App Store) or `Apple Distribution` (App Store); identity
  via `APPLE_SIGNING_IDENTITY` or `bundle.macOS.signingIdentity`.
- Electron splits it: "the app needs to be code signed. Then, the app needs to be uploaded to Apple for a
  process called **notarization**" — https://www.electronjs.org/docs/latest/tutorial/code-signing

### 3.6 Security defaults you inherit

**Tauri v2** — capability/ACL system:
- "Capabilities define which permissions are granted or denied for which windows or webviews"; files live in
  `src-tauri/capabilities` (JSON or TOML) and "**All capabilities inside the capabilities directory are
  automatically enabled by default.** Once capabilities are explicitly enabled in `tauri.conf.json`, only
  these are used." — https://v2.tauri.app/security/capabilities/
- CSP: "The CSP protection is **only enabled if set** on the Tauri configuration file"; Tauri hashes local scripts
  and nonces external ones at compile time — https://v2.tauri.app/security/csp/
- Net effect: deny-by-default at the IPC boundary, but *open* at the webview boundary until you write a CSP.

**Electron** — defaults improved over time, all opt-out:
- `contextIsolation` defaults to `true` since **Electron 12** —
  https://github.com/electron/electron/blob/main/docs/breaking-changes.md
- renderers "are sandboxed by default" since **Electron 20** unless `nodeIntegration: true` /
  `sandbox: false` — same file
- the official checklist still asks for a CSP (`script-src 'self'`), never `nodeIntegration` for
  remote content, and `webSecurity` kept on — https://www.electronjs.org/docs/latest/tutorial/security

For a *file manager* the difference is smaller than marketing suggests: both stacks need (a) a strict CSP, (b) an
explicit allow-list of native operations, (c) no remote content. Tauri's ACL is a stronger *default* for (b)
because commands are not compiled in unless allowed (`build.removeUnusedCommands`, tauri >= 2.4 —
https://v2.tauri.app/concept/size/).

---

## 4. File watching under a home directory, on Windows and macOS

### 4.1 Native primitives and their documented limits

| OS | Primitive used by Node | Documented limit |
| - | - | - |
| Windows | `ReadDirectoryChangesW` | On buffer overflow the call "**will still return true, but the entire contents of the buffer are discarded** and `lpBytesReturned` will be zero… you should compute the changes by **enumerating the directory or subtree**" — https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-readdirectorychangesw |
| macOS | `kqueue` for files, **FSEvents** for directories | "the granularity of notifications is at a **directory level**. It tells you only that *something* in the directory has changed, but does not tell you **what** changed… the file system events daemon also **coalesces** multiple notifications"; you choose the minimum time between events — https://developer.apple.com/library/archive/documentation/Darwin/Conceptual/FSEvents_ProgGuide/TechnologyOverview/TechnologyOverview.html |
| Linux | `inotify` | out of scope here, same "hint, not truth" property |

Node's own caveats (`fs.watch`):
- "On Windows, **no events will be emitted if the watched directory is moved or renamed**. An `EPERM`
  error is reported when the watched directory is deleted."
- "On Linux and macOS, `fs.watch()` resolves the path to an **inode**… If the watched path is deleted and
  recreated, it is assigned a new inode… **Events for the new inode will not be emitted.**"
- watching "can be unreliable, and in some cases impossible, on network file systems (NFS, SMB, etc.)".
- `recursive: true` supported on Windows/macOS/Linux ("Added recursive support for Linux, AIX and IBMi" in
  v19.1.0).
— https://nodejs.org/api/fs.html#fswatchfilename-options-listener

### 4.2 chokidar as the practical layer

Current line is **v6 (Oct 2026)** per its README — https://github.com/paulmillr/chokidar#readme. Relevant
defaults, verbatim from that README:

| Option | Default | Why it matters for a skills tree |
| - | - | - |
| `followSymlinks` | **true** | A junction/symlink farm is followed by default, and "retargeting a link emits `change`". |
| `backend` | `'auto'` | "uses native **recursive** watching on macOS and Windows and native per-directory watching elsewhere". |
| `atomic` | true (native backends) | "Editors that save through a temp file and rename produce `unlink` then `add`; within the window (100 ms by default) Chokidar emits a single `change`"; it also "ignores common editor temp files (.swp/.swx, ~ backups, Sublime .subl*.tmp)". |
| `awaitWriteFinish` | false | Turn on for large writes; otherwise `add`/`change` can fire mid-write. |
| `depth` | unlimited | Scope it: a skills root is shallow. |
| `persistent` | true | Keeps the process alive. |
| polling backend | off | "Polling compares size, modification time, existence, and (except on Windows) inode… **an in-place write that changes none of these is not detected**." |

The README's own framing of the raw API: "`fs.watch` reports many changes as an non-transparent `rename`,
can fire twice for one change, and recursive watching differs across platforms" — exactly what chokidar normalises.

### 4.3 The robust recipe this implies

1. Watch **only** the skill roots (`~/.claude/skills`, `~/.agents/skills`, project
   `.claude/skills`) with `depth: 2-3`, `ignoreInitial: true`, `atomic: true`,
   `awaitWriteFinish: { stabilityThreshold: 300 }`.
2. Treat **every** event as "this subtree is dirty" and schedule a debounced **full re-read** of the affected skill
   folder (a skill folder is a handful of files, so this is cheap). Mandated by both overflow semantics (Windows)
   and directory-level coalescing (macOS).
3. Never trust `change` for parsed YAML correctness — re-read and re-parse. `atomic` covers
   temp-file+rename editors, not in-place truncate+write.
4. Key by `realpath` so one skill reached through three agent dirs yields one row and one refresh.
5. Always offer a manual "Refresh" and refresh on window focus — watchers die (dir deleted → `EPERM`,
   inode replaced → no events).

---

## 5. Local-first security: defaults, and running a local HTTP server safely

### 5.1 Defaults per shell

Covered in §3.6. Summary: Electron sandboxes renderers and isolates context by default but a Node-capable preload
is one option away; Tauri denies IPC commands by default but needs an explicit CSP.

### 5.2 If the UI is a browser tab talking to a local server

The single most important fact: **`server.listen(port)` without a host listens on everything.** Node docs:
"If `host` is omitted, the server will accept connections on the unspecified IPv6 address (<<BT>::`)
when IPv6 is available, or the unspecified IPv4 address (`0.0.0.0`) otherwise."
— https://nodejs.org/api/net.html#serverlisten

Minimum bar for a skill manager's local API:

1. `server.listen(0, '127.0.0.1')` — ephemeral port, loopback only; read the port back with
   `server.address().port` (documented on the same page). Never `0.0.0.0`, never omit the host.
2. **Per-launch bearer token** checked by the server on every request. Loopback is not an authorization boundary:
   any local process — and any browser page via CSRF/DNS rebinding — can reach `127.0.0.1`.
3. **Validate `Host` and `Origin`** and reject unknown values (standard DNS-rebinding defence).
   *Engineering judgement; no primary spec was fetched for this rule — recommended practice, not a cited requirement.*
4. Serve the UI from the same origin as the API (or from `file://`/`asset://` inside the shell) so
   no permissive CORS is ever needed.
5. Prefer the shell's own IPC (Tauri commands / Electron `contextBridge`) over HTTP at all: no port, no
   token, no local attack surface. HTTP is only justified if the UI must live in a real browser tab.

### 5.3 File-operation blast radius

- Resolve every user-supplied path with `realpath` **before** acting, then assert it is inside an allow-listed
  skill root. This also defeats a symlink whose target escapes the root — the primitive that makes the link farm
  work is the primitive that makes path traversal trivial.
- Never recursively delete *through* a link. On Windows `fs.rm(path, { recursive: true })` on a
  reparse-point directory deletes the link itself (libuv special-cases `FILE_ATTRIBUTE_REPARSE_POINT`:
  https://github.com/libuv/libuv/blob/v1.x/src/win/fs.c); POSIX behaviour deserves an explicit `unlink`
  path for links rather than a shared recursive delete.

---

## 6. Storage

### 6.1 SQLite options

| Option | Status / constraint | Source |
| - | - | - |
| `node:sqlite` (built-in) | In Node **24**: "<<BT"> Stability: 1.2 - Release candidate.`" — usable, not frozen; keep a migration path | https://github.com/nodejs/node/blob/v24.x/doc/api/sqlite.md |
| `better-sqlite3` | native addon; "Prebuilt binaries are available for major platforms/architectures"; must match the runtime's ABI (`NODE_MODULE_VERSION`) | https://github.com/WiseLibs/better-sqlite3#readme |
| `better-sqlite3` **inside Electron** | needs an ABI rebuild: "`@electron/rebuild` … can automatically determine the version of Electron and handle the manual steps of downloading headers and rebuilding" | https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules |
| `tauri-plugin-sql` (Tauri) | first-class migrations: the `Migration` struct needs "a unique version number, a description, the SQL to be executed, and the type of migration (Up or Down)" | https://v2.tauri.app/plugin/sql/ |

### 6.2 SQLite vs JSON for this app

Data is small and mostly derived: discovered skills, per-skill UI state (enabled/disabled, pinned, notes), change
log. Two defensible shapes:

- **Disk is the source of truth; the DB is a cache.** Skills are directories with a `SKILL.md`
  (https://agentskills.io/specification) and any external editor or harness can mutate them behind your back (§4),
  so the DB must be reconstructable by a full rescan. Then SQLite buys fast search/filter and transactional writes
  of *your* state, and deleting the DB is harmless.
- **JSON for user state**, SQLite once the dataset grows (hundreds of skills, full-text search). JSON is what the
  ecosystem itself uses: Claude Code's per-project state lands in `.claude/settings.local.json` (written by
  the `/skills` menu) and its global `skillOverrides` is a JSON map in `settings.json`
  (https://code.claude.com/docs/en/skills.md, https://code.claude.com/docs/en/settings.md).

**Do not put user state in files the harness owns** without care. If the manager writes `skillOverrides` into
`~/.claude/settings.json` it must preserve unknown keys, write atomically (temp file + rename — the same
trick editors use), and tolerate the harness rewriting the file. Storing manager state in
`~/.skill-manager/state.db` and *projecting* it into each harness's config is the safer dependency direction.

### 6.3 Migrations

- SQLite: `PRAGMA user_version` + ordered migrations is sufficient; with `tauri-plugin-sql` you inherit
  its versioned Up/Down model.
- JSON: version the document (`{"schemaVersion": 3, ...}`) and migrate on read, backing up the previous file
  once. Both matter because users *downgrade*; a forward-only migration corrupts data on downgrade.

---

## 7. Auto-detecting installed CLIs from a GUI app

### 7.1 Why `process.env.PATH` is not enough

- On macOS, a GUI app's `PATH` is not the Terminal's. The system builds it with `path_helper(8)`, which
  "reads the contents of the files in the directories `/etc/paths.d` and `/etc/manpaths.d` and
  appends their contents to the `PATH`… Prior to reading these directories, default `PATH` and
  `MANPATH` values are obtained from the files `/etc/paths` and `/etc/manpaths`", and it
  "**should not be invoked directly. It is intended only for use by the shell profile**."
  — https://github.com/apple-oss-distributions/shell_cmds/blob/main/path_helper/path_helper.8
  So a `.zshrc`/`.zprofile`-only `export PATH=...` is invisible to an app launched from
  Finder/Dock. (launchd can inject variables via `EnvironmentVariables` in a job plist —
  https://github.com/apple-oss-distributions/launchd/blob/main/man/launchd.plist.5 — but that is per-job
  configuration, not a default.) The exact default `PATH` a Finder-launched app receives is **UNVERIFIED**.
- On Windows, a GUI process inherits the environment of whatever launched it (Explorer), which reflects logon-time
  state; installs that happen afterwards may or may not be visible, and per-user installs often land in directories
  that are not on `PATH` at all. **UNVERIFIED** by citation in this pass — but it is why every serious
  Windows tool-locator probes directories explicitly.

### 7.2 Directories worth probing

Windows:

| Location | What lives there | Source |
| - | - | - |
| `%APPDATA%\npm` (e.g. `C:\Users\<u>\AppData\Roaming\npm`) | npm **global** bin: <<BT><name>`, <<BT><name>.cmd`, <<BT><name>.ps1` shims | **MEASURED**: `npm config get prefix` → `C:\Users\thinkpad\AppData\Roaming\npm`, which contains `9router.cmd`, `omniroute.ps1`, … |
| `%LOCALAPPDATA%\Programs\<app>\` | per-user installers (VS Code, many Electron apps) | **UNVERIFIED** (convention) |
| `%LOCALAPPDATA%\Microsoft\WinGet\Links` | winget shims | **UNVERIFIED** |
| `C:\Program Files\...`, `C:\Program Files (x86)\...` | machine-wide installs | **UNVERIFIED** |
| `%USERPROFILE%\.local\bin` | `uv`, `pipx`, some installer scripts | **UNVERIFIED** |

macOS:

| Location | What lives there | Source |
| - | - | - |
| `/opt/homebrew/bin` | Homebrew default prefix on Apple Silicon ("installs Homebrew to its default prefix (`/opt/homebrew` for Apple Silicon…)") | https://docs.brew.sh/Installation |
| `/usr/local/bin` | Intel Homebrew prefix + many installer scripts | **UNVERIFIED** (the same page's "custom prefixes" note implies it, but does not state it) |
| `~/.local/bin` | `uv`, `pipx`, misc shims | **UNVERIFIED** |
| `~/.cargo/bin` | `rustup`/cargo binaries | **UNVERIFIED** |
| `~/.bun/bin`, `~/.nvm/versions/node/*/bin`, `~/.volta/bin` | version-managed Node CLIs | **UNVERIFIED** |

Both OSes: `~/.claude/skills`, `~/.agents/skills`, `~/.gemini/skills` are the discovery roots
for skills (not CLIs, but the same locate-and-verify problem) —
https://code.claude.com/docs/en/skills.md, https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/skills.md.

### 7.3 Reading shell profiles (macOS)

- zsh login shells read `/etc/zprofile` then `~/.zprofile`; interactive shells read
  `~/.zshrc`. Which file holds a user's `export PATH=` therefore varies. **UNVERIFIED** against a
  primary zsh doc in this pass — check `zsh(1)` "STARTUP/SHUTDOWN FILES" before relying on it.
- If you read a profile, **parse, never execute**. Running `zsh -lic 'echo $PATH'` gives the truth but
  executes arbitrary user code inside your app — a supply-chain hazard you cannot sandbox after the fact. If you do
  it, do it once, with a timeout, in a child process, cached by `(profile mtime, login shell)`.
- The ending everyone converges on: probe a **union** of `process.env.PATH` + the table above + explicit
  user-configured paths; verify each candidate by running `<candidate> --version` with a timeout; let the user
  override with a file picker.

---

## 8. Skill locations the manager must read/write (precision pass)

Full detail lives in the companion note; the load-bearing paths and override rules:

### 8.1 Claude Code

| Scope | Path | Notes |
| - | - | - |
| Enterprise | `.claude/skills/<name>/SKILL.md` inside the managed-settings directory: `/Library/Application Support/ClaudeCode/` (macOS), `/etc/claude-code/` (Linux/WSL), `C:\Program Files\ClaudeCode\` (Windows) | overrides everything |
| Personal | `~/.claude/skills/<name>/SKILL.md` | "On Windows, `~/.claude` means `%USERPROFILE%\.claude`" |
| Project | `.claude/skills/<name>/SKILL.md` | repo-relative |
| Nested | `<subdir>/.claude/skills/<name>/SKILL.md` | loads when the session is in/below `<subdir>` |
| Additional dir | `.claude/skills` under a `--add-dir` path | session-scoped |
| Plugin | `<plugin>/skills/<name>/SKILL.md` | invoked as `/plugin:skill` |
| Synced | `~/.claude/skills/synced/` | reserved; never author a skill named `synced` (any capitalisation) |

Sources: https://code.claude.com/docs/en/skills.md · https://code.claude.com/docs/en/managed-settings.md ·
https://code.claude.com/docs/en/settings.md

- Relocation env var: **`CLAUDE_CONFIG_DIR`** — "To keep the home-directory files somewhere else, set
  `CLAUDE_CONFIG_DIR`; Claude Code then stores your settings, session history, and plugins there instead."
  https://code.claude.com/docs/en/settings.md
- **A native enable/disable toggle exists — in settings, not on disk.** `skillOverrides` maps skill name to
  `"on" | "name-only" | "user-invocable-only" | "off"`; absent means `"on"`; `"off"` hides the
  skill from the `/` menu entirely; the `/skills` menu writes it to `.claude/settings.local.json`
  (`Space` cycles, `Esc` saves). The per-skill frontmatter equivalent of "user-only" is
  `disable-model-invocation: true`; bundled skills can be disabled globally with `disableBundledSkills`.
  https://code.claude.com/docs/en/skills.md
- Reserved/illegal names: `synced`, `anthropic-skills` (or any name starting `anthropic-skills:`),
  names containing a zero-width space or `<`. Deleted personal skills move to `~/.claude/skills/.trash/` and
  are swept after ~30 days. Same page.
- Managed settings precedence: "Claude Code applies them **above every other level**, so no user, project, local, or
  `--settings` value overrides them" — https://code.claude.com/docs/en/managed-settings.md

### 8.2 Gemini CLI

- Discovery tiers, lowest to highest precedence: built-in → extension → **user (`~/.gemini/skills/` or the
  `~/.agents/skills/` alias)** → workspace (`.gemini/skills/` or `.agents/skills/`); within a
  tier the `.agents/skills/` alias wins over `.gemini/skills/`. Same name in two tiers → higher tier wins.
  Activation is explicit via an `activate_skill` tool with a consent prompt.
  https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/skills.md
- The `.agents/skills/` alias is documented as "an interoperable path for managing agent-specific expertise that
  remains compatible across different AI tools" — same page. That is the closest thing to a cross-harness canonical
  directory any vendor documents.

### 8.3 The shared format

- Directory + `SKILL.md`; frontmatter `name` (required, <=64 chars, lowercase/digits/hyphens, must equal
  the parent directory name) and `description` (required, 1-1024 chars); optional `license`,
  `compatibility` (<=500), `metadata` (string→string), `allowed-tools`.
  https://agentskills.io/specification
- Codex/ChatGPT: the official `developers.openai.com/codex/skills` URL **308-redirects off-domain** and could not
  be read; Codex-specific paths and extensions are **UNVERIFIED** here (the companion note cites
  `learn.chatgpt.com/codex/skills.md` for an `agents/openai.yaml` extension, which I did not
  independently confirm).

---

## 9. Design constraints that follow (summary for the planner)

1. **Link strategy**: junction on Windows (`fs.symlink(target, link, 'junction')`, absolute target), symlink
   elsewhere; on failure fall back to copy *and surface it in the UI* — what the existing `npx skills` CLI
   already does (companion note §2.1).
2. **Identity**: key by `realpath`; dedupe across agent dirs; never by name alone.
3. **Directory detection**: `stat()` to decide "is a directory", `lstat()` to decide "is a link"; never
   `dirent.isDirectory()`.
4. **Broken links are normal** (target deleted, moved, cloud-sync placeholder). Show them as "unresolved" with a
   re-link/repair action rather than deleting them.
5. **Watcher = trigger, not truth**: debounce + full re-read; refresh on focus; manual refresh always available.
6. **Shell choice**: Tauri if installer size/memory matter and Rust can live in CI; Electron if the team is JS-only and
   a bundled Chromium is acceptable. Neither removes the need for certificates or a CSP.
7. **Never bind a socket to 0.0.0.0**; loopback + per-launch token + Host/Origin checks if HTTP is used at all.
8. **Storage**: DB is a cache, disk is the truth; JSON or SQLite both fine at this scale; version the schema and handle
   downgrade.

---

## 10. What I could NOT confirm

| Item | Why |
| - | - |
| Junction to a **different drive** | Only `C:\` exists on this machine. Microsoft docs say it is allowed between local volumes; not executed. |
| Exact errno Node raises for `fs.symlink` with Developer Mode **off** and no elevation | Requires admin to toggle Developer Mode; libuv has no mapping for `ERROR_PRIVILEGE_NOT_HELD` → likely `UNKNOWN`, possibly `EPERM`. |
| Windows **cloud-sync placeholder** files (OneDrive) as link targets | Not tested; home dir here is not OneDrive-redirected. |
| Installed-size numbers for real Tauri and Electron apps | No official published figures; neither app was built here. Tauri's "600KB" is a claim about the binary, not the installer. |
| Codex CLI skill directory and `agents/openai.yaml` | Official page 308-redirects to a host that would not serve content. **UNVERIFIED.** |
| macOS default `PATH` delivered to a Finder-launched app | No primary Apple statement found; `path_helper(8)` only proves *shell* path composition. |
| Whether Gemini CLI / Codex **follow symlinked skill folders** | Vendor docs do not say; only Claude Code documents symlink support explicitly. |
| `better-sqlite3` + Electron prebuild availability matrix | Not checked against the current release matrix. |
| Windows `lstat().ino` stability as an identity key | Not tested. |

---

## 11. Source index

Microsoft (Windows semantics)
- https://learn.microsoft.com/en-us/windows/win32/fileio/hard-links-and-junctions
- https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-points
- https://learn.microsoft.com/en-us/windows/win32/fileio/symbolic-links
- https://learn.microsoft.com/en-us/windows/win32/fileio/symbolic-link-programming-considerations
- https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createsymboliclinkw
- https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-readdirectorychangesw
- https://learn.microsoft.com/en-us/windows/apps/get-started/enable-your-device-for-development
- https://blogs.windows.com/windowsdeveloper/2016/12/02/symlinks-windows-10/

Node.js / libuv
- https://nodejs.org/api/fs.html
- https://nodejs.org/api/net.html#serverlisten
- https://github.com/libuv/libuv/blob/v1.x/src/win/fs.c
- https://github.com/libuv/libuv/blob/v1.x/src/win/error.c
- https://github.com/nodejs/node/blob/v24.x/doc/api/sqlite.md
- https://github.com/nodejs/node/blob/main/doc/api/fs.md

Traversal (Go / Rust / Python / Node glob)
- https://github.com/golang/go/blob/master/src/io/fs/walk.go
- https://github.com/BurntSushi/walkdir/blob/master/src/lib.rs
- https://docs.python.org/3/library/os.html#os.walk
- https://docs.python.org/3/library/glob.html
- https://github.com/isaacs/node-glob#readme

Tauri v2
- https://v2.tauri.app/
- https://v2.tauri.app/start/prerequisites/
- https://v2.tauri.app/concept/size/
- https://v2.tauri.app/distribute/sign/windows/
- https://v2.tauri.app/distribute/sign/macos/
- https://v2.tauri.app/plugin/updater/
- https://v2.tauri.app/plugin/sql/
- https://v2.tauri.app/security/capabilities/
- https://v2.tauri.app/security/csp/

Electron
- https://github.com/electron/electron#readme
- https://www.electronjs.org/docs/latest/tutorial/security
- https://www.electronjs.org/docs/latest/tutorial/code-signing
- https://www.electronjs.org/docs/latest/tutorial/updates
- https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules
- https://github.com/electron/electron/blob/main/docs/breaking-changes.md

Watching
- https://github.com/paulmillr/chokidar#readme
- https://developer.apple.com/library/archive/documentation/Darwin/Conceptual/FSEvents_ProgGuide/TechnologyOverview/TechnologyOverview.html

macOS environment / PATH
- https://github.com/apple-oss-distributions/shell_cmds/blob/main/path_helper/path_helper.8
- https://github.com/apple-oss-distributions/launchd/blob/main/man/launchd.plist.5
- https://docs.brew.sh/Installation

Skills (format, paths, toggles)
- https://agentskills.io/specification
- https://code.claude.com/docs/en/skills.md
- https://code.claude.com/docs/en/settings.md
- https://code.claude.com/docs/en/managed-settings.md
- https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/skills.md

Storage
- https://github.com/WiseLibs/better-sqlite3#readme
