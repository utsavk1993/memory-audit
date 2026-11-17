// How `memory-audit ui` chooses what to start (lib/cli/launcher.ts), on every platform.

import path from "node:path";
import { describe, expect, it } from "vitest";
import { pathKey, pickLauncher, spawnCommand, stopHint } from "@/lib/cli/launcher";

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

  it("then an installed command on PATH", () => {
    const dirs = ["", "/usr/local/bin", "/opt/bin"].join(path.delimiter);
    expect(pickLauncher({ ...base, pathEnv: dirs, exists: has(path.join("/opt/bin", "memory-audit")) })).toEqual({
      bin: path.join("/opt/bin", "memory-audit"),
      args: [],
      shell: false,
      label: path.join("/opt/bin", "memory-audit"),
    });
  });

  it("on Windows, runs the launcher behind the .cmd shim with Node (no shell, so spaces in paths work)", () => {
    const prefix = "/Users/Jane Doe/AppData/Roaming/npm";
    const launcher = path.join(prefix, "node_modules", "memory-audit", "bin", "memory-audit.mjs");
    const cmd = path.join(prefix, "memory-audit.cmd");
    const win = { ...base, platform: "win32" as const, pathEnv: prefix };
    expect(pickLauncher({ ...win, exists: has(cmd, launcher) })).toEqual({ bin: "/node", args: [launcher], shell: false, label: launcher });
    // A shim without the package behind it (or a package without the shim) isn't used.
    expect(pickLauncher({ ...win, exists: has(cmd) }).label).toBe("npx memory-audit");
    expect(pickLauncher({ ...win, exists: has(launcher) }).label).toBe("npx memory-audit");
  });

  it("falls back to npx: the npx script next to Node on Windows, else npx.cmd through a shell", () => {
    expect(pickLauncher({ ...base, exists: () => false })).toEqual({ bin: "npx", args: ["--yes", "memory-audit"], shell: false, label: "npx memory-audit" });
    const npxCli = path.join("/", "node_modules", "npm", "bin", "npx-cli.js");
    expect(pickLauncher({ ...base, platform: "win32", exists: has(npxCli) })).toEqual({
      bin: "/node",
      args: [npxCli, "--yes", "memory-audit"],
      shell: false,
      label: "npx memory-audit",
    });
    expect(pickLauncher({ ...base, platform: "win32", exists: () => false })).toMatchObject({ bin: "npx.cmd", shell: true });
    // On other platforms the npx script is never used directly.
    expect(pickLauncher({ ...base, exists: has(npxCli) }).bin).toBe("npx");
  });
});

describe("spawnCommand", () => {
  it("passes arguments as a list, or as one command string when a shell is needed", () => {
    expect(spawnCommand({ bin: "/node", args: ["/a b/x.mjs"], shell: false, label: "" }, ["--port", "1"])).toEqual(["/node", ["/a b/x.mjs", "--port", "1"]]);
    expect(spawnCommand({ bin: "npx.cmd", args: ["--yes", "memory-audit"], shell: true, label: "" }, ["--port", "1"])).toEqual([
      "npx.cmd --yes memory-audit --port 1",
      [],
    ]);
  });
});

describe("stopHint", () => {
  it("kills the whole process group, or the process tree on Windows", () => {
    expect(stopHint(42, "linux")).toBe("kill -- -42");
    expect(stopHint(42, "win32")).toBe("taskkill /PID 42 /T /F");
    expect(stopHint(undefined, "linux")).toBe("");
  });
});

describe("pathKey", () => {
  it("ignores case on macOS and Windows only", () => {
    expect(pathKey("darwin")("/Users/Jane")).toBe("/users/jane");
    expect(pathKey("win32")("C:\\Users\\Jane")).toBe("c:\\users\\jane");
    expect(pathKey("linux")("/home/Jane")).toBe("/home/Jane");
  });
});
