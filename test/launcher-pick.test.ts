// How `memory-audit ui` chooses what to start (lib/cli/launcher.ts), on every platform.

import path from "node:path";
import { describe, expect, it } from "vitest";
import { pickLauncher, stopHint } from "@/lib/cli/launcher";

const PKG = path.resolve("/pkg/node_modules/memory-audit");
const base = { selfFile: path.join(PKG, "plugin", "dist", "cli.mjs"), platform: "darwin" as const, execPath: "/node" };
const has = (...files: string[]) => (p: string) => files.includes(p);

describe("pickLauncher", () => {
  it("prefers a source checkout from MEMORY_AUDIT_APP_DIR", () => {
    const launcher = path.join(path.resolve("/src/app"), "bin", "memory-audit.mjs");
    expect(pickLauncher({ ...base, appDir: "/src/app", exists: has(launcher) })).toEqual({ bin: "/node", args: [launcher], shell: false, label: launcher });
  });

  it("then the built npm package it was run from, skipping an app dir without a launcher", () => {
    const launcher = path.join(PKG, "bin", "memory-audit.mjs");
    const r = pickLauncher({ ...base, appDir: "/nothing", exists: has(launcher, path.join(PKG, ".next", "BUILD_ID")) });
    expect(r).toMatchObject({ bin: "/node", args: [launcher] });
  });

  it("skips the package when it isn't built, or when the CLI isn't the bundled one", () => {
    const launcher = path.join(PKG, "bin", "memory-audit.mjs");
    expect(pickLauncher({ ...base, exists: has(launcher) }).label).toBe("npx memory-audit");
    const fromSource = { ...base, selfFile: path.join(PKG, "lib", "cli", "main.ts") };
    expect(pickLauncher({ ...fromSource, exists: has(launcher, path.join(PKG, ".next", "BUILD_ID")) }).label).toBe("npx memory-audit");
  });

  it("then an installed command on PATH (the .cmd shim, through a shell, on Windows)", () => {
    const dirs = ["", "/usr/local/bin", "/opt/bin"].join(path.delimiter);
    expect(pickLauncher({ ...base, pathEnv: dirs, exists: has(path.join("/opt/bin", "memory-audit")) })).toEqual({
      bin: path.join("/opt/bin", "memory-audit"),
      args: [],
      shell: false,
      label: path.join("/opt/bin", "memory-audit"),
    });
    const win = pickLauncher({ ...base, platform: "win32", pathEnv: dirs, exists: has(path.join("/opt/bin", "memory-audit.cmd")) });
    expect(win).toMatchObject({ bin: path.join("/opt/bin", "memory-audit.cmd"), shell: true });
  });

  it("falls back to npx (npx.cmd through a shell on Windows)", () => {
    expect(pickLauncher({ ...base, exists: () => false })).toEqual({ bin: "npx", args: ["--yes", "memory-audit"], shell: false, label: "npx memory-audit" });
    expect(pickLauncher({ ...base, platform: "win32", exists: () => false })).toMatchObject({ bin: "npx.cmd", shell: true });
  });
});

describe("stopHint", () => {
  it("kills the whole process group, or the process tree on Windows", () => {
    expect(stopHint(42, "linux")).toBe("kill -- -42");
    expect(stopHint(42, "win32")).toBe("taskkill /PID 42 /T /F");
    expect(stopHint(undefined, "linux")).toBe("");
  });
});
