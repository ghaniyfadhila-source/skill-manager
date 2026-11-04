import { describe, expect, it } from "vitest";
import { ApiError } from "./api.js";
import {
  type ConfirmPrompt,
  confirmAndRun,
  driftPrompt,
  sharedImpactFromError,
  sharedPrompt,
  uninstallPrompt,
} from "./confirm.js";

function sharedError(): ApiError {
  return new ApiError({
    code: "shared_confirmation_required",
    message: "Memasang ke grup shared akan terlihat oleh semua member terdampak.",
    status: 409,
    details: {
      stores: [{ storeId: "~/.agents/skills", members: ["codex", "gemini", "cursor", "copilot"] }],
      targets: ["shared/global"],
    },
  });
}

interface Options {
  readonly acknowledgeShared: boolean;
  readonly force: boolean;
}

describe("konfirmasi grup shared (AC-6)", () => {
  it("menampilkan member terdampak lalu mengirim ulang dengan acknowledgeShared", async () => {
    const calls: Options[] = [];
    const prompts: ConfirmPrompt[] = [];
    const operation = (options: Options): Promise<string> => {
      calls.push(options);
      return options.acknowledgeShared
        ? Promise.resolve("terpasang")
        : Promise.reject(sharedError());
    };

    const result = await confirmAndRun("install", operation, (prompt) => {
      prompts.push(prompt);
      return Promise.resolve(true);
    });

    expect(result).toBe("terpasang");
    expect(calls).toEqual([
      { acknowledgeShared: false, force: false },
      { acknowledgeShared: true, force: false },
    ]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.kind).toBe("shared");
    const text = `${prompts[0]?.message ?? ""} ${(prompts[0]?.details ?? []).join(" ")}`;
    for (const member of ["codex", "gemini", "cursor", "copilot"]) {
      expect(text).toContain(member);
    }
  });

  it("berhenti tanpa mengirim ulang bila user menolak", async () => {
    const calls: Options[] = [];
    const operation = (options: Options): Promise<string> => {
      calls.push(options);
      return Promise.reject(sharedError());
    };

    const result = await confirmAndRun(
      "uninstall",
      operation,
      () => Promise.resolve(false),
      "alpha",
    );

    expect(result).toBeNull();
    expect(calls).toEqual([{ acknowledgeShared: false, force: false }]);
  });

  it("tidak meminta konfirmasi untuk galat yang bukan keputusan user", async () => {
    let asked = 0;
    const operation = (): Promise<string> =>
      Promise.reject(
        new ApiError({ code: "internal_error", message: "Server rusak.", status: 500 }),
      );

    await expect(
      confirmAndRun("install", operation, () => {
        asked += 1;
        return Promise.resolve(true);
      }),
    ).rejects.toMatchObject({ code: "internal_error" });
    expect(asked).toBe(0);
  });
});

describe("konfirmasi drift saat mencabut", () => {
  it("menawarkan force setelah shared disetujui", async () => {
    const calls: Options[] = [];
    const prompts: ConfirmPrompt[] = [];
    const operation = (options: Options): Promise<string> => {
      calls.push(options);
      if (!options.acknowledgeShared) {
        return Promise.reject(sharedError());
      }
      if (!options.force) {
        return Promise.reject(
          new ApiError({
            code: "drift_detected",
            message: "Isi Store sudah berubah sejak dipasang.",
            status: 409,
            details: {
              storeId: "~/.agents/skills",
              path: "/home/u/.agents/skills/alpha",
              expectedHash: "sha256:aaa",
              actualHash: "sha256:bbb",
            },
          }),
        );
      }
      return Promise.resolve("tercabut");
    };

    const result = await confirmAndRun(
      "uninstall",
      operation,
      (prompt) => {
        prompts.push(prompt);
        return Promise.resolve(true);
      },
      "alpha",
    );

    expect(result).toBe("tercabut");
    expect(calls).toEqual([
      { acknowledgeShared: false, force: false },
      { acknowledgeShared: true, force: false },
      { acknowledgeShared: true, force: true },
    ]);
    expect(prompts.map((prompt) => prompt.kind)).toEqual(["shared", "drift"]);
    expect(prompts[1]?.message).toContain("alpha");
  });
});

describe("pemetaan galat menjadi prompt", () => {
  it("mengenali konfirmasi shared dari code walau status bukan 409", () => {
    const impact = sharedImpactFromError(
      new ApiError({
        code: "shared_confirmation_required",
        message: "Setujui dulu.",
        status: 400,
        details: { stores: [{ storeId: "~/.agents/skills", members: ["codex"] }] },
      }),
    );

    expect(impact?.stores).toEqual([{ storeId: "~/.agents/skills", members: ["codex"] }]);
    expect(impact === null ? null : sharedPrompt(impact, "uninstall").kind).toBe("shared");
  });

  it("mengabaikan galat tanpa daftar member", () => {
    const impact = sharedImpactFromError(
      new ApiError({ code: "shared_confirmation_required", message: "x", status: 409 }),
    );

    expect(impact).toBeNull();
  });

  it("menyusun prompt drift dengan path dan nama skill", () => {
    const prompt = driftPrompt(
      { storeId: "~/.agents/skills", path: "/home/u/.agents/skills/alpha" },
      "alpha",
    );

    expect(prompt.kind).toBe("drift");
    expect(prompt.details.join(" ")).toContain("/home/u/.agents/skills/alpha");
  });
});

describe("konfirmasi sebelum mencabut (AC-6)", () => {
  it("menyebut dampak pencabutan: skill, Target, dan Library tetap utuh", () => {
    const prompt = uninstallPrompt("alpha", "claude-code/global", "~/.claude/skills");

    expect(prompt.kind).toBe("destructive");
    const text = `${prompt.title} ${prompt.message} ${prompt.details.join(" ")}`;
    expect(text).toContain("alpha");
    expect(text).toContain("claude-code/global");
    expect(text).toContain("~/.claude/skills");
    expect(text).toMatch(/Library/);
    expect(text).toMatch(/[Dd]ihapus/);
  });

  it("tanpa Store yang diketahui, dampaknya tetap disebut", () => {
    const prompt = uninstallPrompt("alpha", "claude-code/global");

    expect(prompt.details.join(" ")).not.toBe("");
  });
});
