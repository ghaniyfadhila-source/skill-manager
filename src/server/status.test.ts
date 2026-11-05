import { describe, expect, it } from "vitest";
import { statusForCode } from "./app.js";

describe("pemetaan kode galat domain ke status HTTP", () => {
  it.each([
    ["conflict", 409],
    ["install_conflict", 409],
    ["name_conflict", 409],
    ["shared_confirmation_required", 409],
    ["drift_detected", 409],
    ["confirmation_required", 409],
    ["skill_not_found", 404],
    ["source_not_found", 404],
    ["invalid_target", 400],
    ["invalid_path", 400],
    ["invalid_git_url", 400],
    ["bad_request", 400],
    ["unsupported_version", 500],
    ["state_unsupported_version", 500],
    ["io_error", 500],
    ["unauthorized", 401],
    ["forbidden", 403],
  ])("%s -> %i", (code, status) => {
    expect(statusForCode(code)).toBe(status);
  });

  it("memakai 400 untuk kode yang tidak dikenal", () => {
    expect(statusForCode("kode_baru_yang_belum_dipetakan")).toBe(400);
  });
});
