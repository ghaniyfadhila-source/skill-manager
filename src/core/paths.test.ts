import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  adaptersRoot,
  DATA_ROOT_ENV,
  dataRootPaths,
  depsRoot,
  libraryRoot,
  resolveDataRoot,
  statePath,
} from "./paths.js";

describe("resolveDataRoot — Windows", () => {
  it("memakai %LOCALAPPDATA%\\SkillManager", () => {
    const root = resolveDataRoot({
      platform: "win32",
      homedir: "C:\\Users\\ani",
      env: { LOCALAPPDATA: "D:\\Data" },
    });

    expect(root).toBe(path.win32.join("D:\\Data", "SkillManager"));
  });

  it("jatuh ke folder AppData\\Local bila LOCALAPPDATA tidak ada", () => {
    const root = resolveDataRoot({
      platform: "win32",
      homedir: "C:\\Users\\ani",
      env: {},
    });

    expect(root).toBe(path.win32.join("C:\\Users\\ani", "AppData", "Local", "SkillManager"));
  });
});

describe("resolveDataRoot — Linux", () => {
  it("memakai XDG_DATA_HOME", () => {
    const root = resolveDataRoot({
      platform: "linux",
      homedir: "/home/ani",
      env: { XDG_DATA_HOME: "/var/data/ani" },
    });

    expect(root).toBe(path.posix.join("/var/data/ani", "skillmanager"));
  });

  it("jatuh ke ~/.local/share bila XDG_DATA_HOME kosong", () => {
    const root = resolveDataRoot({
      platform: "linux",
      homedir: "/home/ani",
      env: { XDG_DATA_HOME: "  " },
    });

    expect(root).toBe(path.posix.join("/home/ani", ".local", "share", "skillmanager"));
  });
});

describe("resolveDataRoot — override", () => {
  it("env SKILL_MANAGER_DATA_ROOT menang atas lokasi platform", () => {
    expect(
      resolveDataRoot({
        platform: "win32",
        homedir: "C:\\Users\\ani",
        env: { [DATA_ROOT_ENV]: "E:\\SkillManagerDev", LOCALAPPDATA: "D:\\Data" },
      }),
    ).toBe("E:\\SkillManagerDev");

    expect(
      resolveDataRoot({
        platform: "linux",
        homedir: "/home/ani",
        env: { [DATA_ROOT_ENV]: "/tmp/sm-dev", XDG_DATA_HOME: "/var/data" },
      }),
    ).toBe("/tmp/sm-dev");
  });

  it("override kosong diabaikan", () => {
    const root = resolveDataRoot({
      platform: "linux",
      homedir: "/home/ani",
      env: { [DATA_ROOT_ENV]: "   ", XDG_DATA_HOME: "/var/data" },
    });

    expect(root).toBe(path.posix.join("/var/data", "skillmanager"));
  });
});

describe("path turunan data root", () => {
  it("menyusun library, adapters, deps, dan state.json", () => {
    const root = path.join(path.sep, "data", "SkillManager");

    expect(libraryRoot(root)).toBe(path.join(root, "library"));
    expect(adaptersRoot(root)).toBe(path.join(root, "adapters"));
    expect(depsRoot(root)).toBe(path.join(root, "deps"));
    expect(statePath(root)).toBe(path.join(root, "state.json"));
    expect(dataRootPaths(root)).toEqual({
      root,
      library: path.join(root, "library"),
      adapters: path.join(root, "adapters"),
      deps: path.join(root, "deps"),
      stateFile: path.join(root, "state.json"),
    });
  });
});
