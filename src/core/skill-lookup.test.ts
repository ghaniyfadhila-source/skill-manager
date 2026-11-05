import path from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "../fs/memory.js";
import {
  captureError,
  DATA_ROOT,
  fixture,
  LIBRARY,
  ok,
  SKILL_NAME,
  setupSkill,
} from "../maintenance/testing.js";
import { findLibrarySkill, resolveLibrarySkill } from "./skill-lookup.js";

describe("findLibrarySkill", () => {
  it("menemukan skill lewat nama maupun id", async () => {
    const setup = await fixture();
    await setupSkill(setup, []);
    const id = ok(await setup.fs.readdir(path.join(DATA_ROOT, "library")));

    const byName = await findLibrarySkill(setup.fs, DATA_ROOT, SKILL_NAME);
    expect(byName.skill.name).toBe(SKILL_NAME);

    const byId = await findLibrarySkill(setup.fs, DATA_ROOT, byName.skill.id);
    expect(byId.skill.id).toBe(byName.skill.id);
    expect(id.length).toBe(1);
  });

  it("memberi skill_not_found untuk nama yang tidak ada", async () => {
    const setup = await fixture();
    await setupSkill(setup, []);

    const error = await captureError(() => findLibrarySkill(setup.fs, DATA_ROOT, "tidak-ada"));

    expect(error.code).toBe("skill_not_found");
  });

  it("tetap berhasil walau isi Library sudah dihapus", async () => {
    const setup = await fixture();
    await setupSkill(setup, []);
    ok(await setup.fs.remove(path.join(LIBRARY, SKILL_NAME), { recursive: true }));

    // Mencabut hanya butuh catatan state; isi Library yang hilang tidak boleh
    // menghalangi pembersihan di Store.
    const found = await findLibrarySkill(setup.fs, DATA_ROOT, SKILL_NAME);

    expect(found.skill.name).toBe(SKILL_NAME);
  });
});

describe("resolveLibrarySkill", () => {
  it("mengembalikan folder isi skill di Library", async () => {
    const setup = await fixture();
    await setupSkill(setup, []);

    const resolved = await resolveLibrarySkill(setup.fs, DATA_ROOT, SKILL_NAME);

    expect(resolved.source).toBe(path.join(LIBRARY, SKILL_NAME));
  });

  it("menolak walau tercatat bila folder isinya hilang", async () => {
    const setup = await fixture();
    await setupSkill(setup, []);
    ok(await setup.fs.remove(path.join(LIBRARY, SKILL_NAME), { recursive: true }));

    // Memasang dari Library yang isinya hilang harus gagal dengan kode stabil,
    // bukan galat filesystem mentah — beda perlakuan dengan findLibrarySkill.
    const error = await captureError(() => resolveLibrarySkill(setup.fs, DATA_ROOT, SKILL_NAME));

    expect(error.code).toBe("skill_not_found");
    expect(error.message).toContain("tidak ditemukan di Library");
  });
});
