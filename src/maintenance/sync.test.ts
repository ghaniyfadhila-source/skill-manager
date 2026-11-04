import path from "node:path";
import { describe, expect, it } from "vitest";
import { contentHash } from "../core/hash.js";
import { loadState } from "../core/state.js";
import { TEMP_PREFIX } from "../fs/atomic.js";
import { MemoryFileSystem } from "../fs/memory.js";
import type { FsResult } from "../fs/types.js";
import { cleanTempDirs, runDoctor } from "./doctor.js";
import { syncSkill } from "./sync.js";
import {
  captureError,
  DATA_ROOT,
  type Fixture,
  fixture,
  HOME,
  installedPath,
  LIBRARY,
  mkdirp,
  ok,
  SKILL_MD,
  SKILL_NAME,
  setupSkill,
  storePath,
  TIPS,
} from "./testing.js";

const USER_EDIT = "# versi pengguna\n";

function sync(
  setup: Fixture,
  options: {
    readonly action: "restore" | "adopt";
    readonly targets?: readonly string[];
    readonly confirm?: boolean;
  },
) {
  return syncSkill({
    fs: setup.fs,
    dataRoot: DATA_ROOT,
    adapters: setup.adapters,
    home: HOME,
    skill: SKILL_NAME,
    ...options,
  });
}

async function tempNames(setup: Fixture, harness: string): Promise<string[]> {
  const entries = ok(await setup.fs.readdir(storePath(harness)));
  return entries.map((entry) => entry.name).filter((name) => name.startsWith(TEMP_PREFIX));
}

describe("syncSkill", () => {
  it("restore menimpa Store dari Library dan memperbarui installedHash (AC-8)", async () => {
    const setup = await fixture();
    await setupSkill(setup, ["claude-code/global"]);
    ok(await setup.fs.write(path.join(installedPath("claude-code"), "SKILL.md"), USER_EDIT));

    const results = await sync(setup, {
      action: "restore",
      targets: ["claude-code/global"],
      confirm: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      targetId: "claude-code/global",
      ok: true,
      installation: { installedHash: setup.skill.contentHash },
    });
    expect(ok(await setup.fs.readText(path.join(installedPath("claude-code"), "SKILL.md")))).toBe(
      SKILL_MD,
    );
    expect(ok(await contentHash(setup.fs, installedPath("claude-code")))).toBe(
      setup.skill.contentHash,
    );
    const { state } = await loadState(setup.fs, DATA_ROOT);
    expect(state.installations[0]?.installedHash).toBe(setup.skill.contentHash);
    expect(await tempNames(setup, "claude-code")).toEqual([]);
  });

  it("menolak tanpa confirm dan tidak mengubah file apa pun", async () => {
    const setup = await fixture();
    await setupSkill(setup, ["claude-code/global"]);
    ok(await setup.fs.write(path.join(installedPath("claude-code"), "SKILL.md"), USER_EDIT));
    const before = await loadState(setup.fs, DATA_ROOT);

    const error = await captureError(() => sync(setup, { action: "restore", confirm: false }));

    expect(error.code).toBe("confirmation_required");
    expect(ok(await setup.fs.readText(path.join(installedPath("claude-code"), "SKILL.md")))).toBe(
      USER_EDIT,
    );
    const after = await loadState(setup.fs, DATA_ROOT);
    expect(after.state).toEqual(before.state);
    expect(await tempNames(setup, "claude-code")).toEqual([]);
  });

  it("adopt memperbarui hash Library dan installedHash tanpa menyalin isi", async () => {
    const setup = await fixture();
    await setupSkill(setup, ["claude-code/global"]);
    ok(await setup.fs.write(path.join(installedPath("claude-code"), "SKILL.md"), USER_EDIT));
    const storeHash = ok(await contentHash(setup.fs, installedPath("claude-code")));

    const results = await sync(setup, {
      action: "adopt",
      targets: ["claude-code/global"],
      confirm: true,
    });

    expect(results[0]).toMatchObject({ ok: true, installation: { installedHash: storeHash } });
    const { state } = await loadState(setup.fs, DATA_ROOT);
    expect(state.library[0]?.contentHash).toBe(storeHash);
    expect(state.installations[0]?.installedHash).toBe(storeHash);
    // Library tidak disalin ulang dari Store.
    expect(ok(await setup.fs.readText(path.join(LIBRARY, SKILL_NAME, "SKILL.md")))).toBe(SKILL_MD);
    expect(
      ok(await setup.fs.readText(path.join(LIBRARY, SKILL_NAME, "references", "tips.md"))),
    ).toBe(TIPS);
  });

  it("restore default menjangkau semua Target yang tercatat", async () => {
    const setup = await fixture();
    await setupSkill(setup, ["claude-code/global", "opencode/global"]);
    ok(await setup.fs.write(path.join(installedPath("claude-code"), "SKILL.md"), USER_EDIT));
    ok(await setup.fs.write(path.join(installedPath("opencode"), "SKILL.md"), USER_EDIT));

    const results = await sync(setup, { action: "restore", confirm: true });

    expect(results.map((result) => [result.targetId, result.ok])).toEqual([
      ["claude-code/global", true],
      ["opencode/global", true],
    ]);
    for (const harness of ["claude-code", "opencode"]) {
      expect(ok(await contentHash(setup.fs, installedPath(harness)))).toBe(setup.skill.contentHash);
    }
  });

  it("restore membuat ulang Store yang seluruhnya hilang", async () => {
    const setup = await fixture();
    await setupSkill(setup, ["claude-code/global"]);
    ok(await setup.fs.remove(storePath("claude-code"), { recursive: true }));

    const results = await sync(setup, {
      action: "restore",
      targets: ["claude-code/global"],
      confirm: true,
    });

    expect(results[0]).toMatchObject({ ok: true });
    expect(ok(await contentHash(setup.fs, installedPath("claude-code")))).toBe(
      setup.skill.contentHash,
    );
  });

  it("restore sukses tidak meninggalkan staging maupun backup", async () => {
    const setup = await fixture();
    await setupSkill(setup, ["claude-code/global"]);
    ok(await setup.fs.write(path.join(installedPath("claude-code"), "SKILL.md"), USER_EDIT));

    await sync(setup, { action: "restore", targets: ["claude-code/global"], confirm: true });

    expect(ok(await setup.fs.readdir(storePath("claude-code"))).map((entry) => entry.name)).toEqual(
      [SKILL_NAME],
    );
  });

  it("restore mengembalikan isi lama bila rename staging gagal (tanpa kehilangan skill)", async () => {
    const failingFs = new SwapFailFs();
    const setup = await fixture({ fs: failingFs });
    await setupSkill(setup, ["claude-code/global"]);
    ok(await failingFs.write(path.join(installedPath("claude-code"), "SKILL.md"), USER_EDIT));
    failingFs.failSwap = true;

    const results = await sync(setup, {
      action: "restore",
      targets: ["claude-code/global"],
      confirm: true,
    });

    expect(results[0]).toMatchObject({ ok: false, error: { code: "io_error" } });
    expect(ok(await setup.fs.readText(path.join(installedPath("claude-code"), "SKILL.md")))).toBe(
      USER_EDIT,
    );
    expect(await tempNames(setup, "claude-code")).toEqual([]);
    const { state } = await loadState(setup.fs, DATA_ROOT);
    expect(state.installations[0]?.installedHash).toBe(setup.skill.contentHash);
  });

  it("sisa crash dilaporkan doctor dan restore berikutnya tetap bekerja", async () => {
    const setup = await fixture();
    await setupSkill(setup, ["claude-code/global"]);
    const target = installedPath("claude-code");
    const backup = path.join(storePath("claude-code"), `${TEMP_PREFIX}backup-crash`);
    const staging = path.join(storePath("claude-code"), `${TEMP_PREFIX}restore-crash`);
    ok(await setup.fs.rename(target, backup));
    await mkdirp(setup.fs, staging);
    ok(await setup.fs.write(path.join(staging, "SKILL.md"), "# belum selesai\n"));

    const crashed = await runDoctor(setup.fs, DATA_ROOT, { adapters: setup.adapters, home: HOME });
    expect(crashed.tempDirs).toEqual([backup, staging]);
    expect(crashed.missing.map((entry) => entry.path)).toEqual([target]);

    const results = await sync(setup, {
      action: "restore",
      targets: ["claude-code/global"],
      confirm: true,
    });
    expect(results[0]).toMatchObject({ ok: true });
    expect(ok(await contentHash(setup.fs, target))).toBe(setup.skill.contentHash);

    const after = await runDoctor(setup.fs, DATA_ROOT, { adapters: setup.adapters, home: HOME });
    expect(after.missing).toEqual([]);
    expect(after.tempDirs).toEqual([backup, staging]);

    const removed = await cleanTempDirs(setup.fs, DATA_ROOT, {
      adapters: setup.adapters,
      home: HOME,
    });
    expect(removed).toEqual([backup, staging]);
    expect(await setup.fs.exists(target)).toBe(true);
  });
});

/** Simulasi kegagalan rename staging -> target. */
class SwapFailFs extends MemoryFileSystem {
  failSwap = false;

  override async rename(from: string, to: string): Promise<FsResult<void>> {
    if (this.failSwap && path.basename(from).startsWith(`${TEMP_PREFIX}restore-`)) {
      return { ok: false, error: { code: "io_error", path: to, message: "ditolak (simulasi)" } };
    }
    return super.rename(from, to);
  }
}
