// How `memory-audit ui` starts the web app. Kept separate from main.ts so every case can be tested
// without depending on how or where the CLI itself is installed.

import path from "node:path";

export interface Launch {
  bin: string;
  args: string[];
  /** Windows needs a shell to run .cmd files (Node refuses to spawn them directly). */
  shell: boolean;
  /** What to call it in an error message. */
  label: string;
}

export function pickLauncher(o: {
  /** MEMORY_AUDIT_APP_DIR: a source checkout. */
  appDir?: string;
  /** The running CLI file. Inside the npm package it is <package>/plugin/dist/cli.mjs, next to the app. */
  selfFile: string;
  pathEnv?: string;
  platform: NodeJS.Platform;
  exists: (p: string) => boolean;
  execPath: string;
}): Launch {
  const win = o.platform === "win32";
  const node = (launcher: string): Launch => ({ bin: o.execPath, args: [launcher], shell: false, label: launcher });

  // 1. A source checkout the user pointed at.
  if (o.appDir) {
    const launcher = path.join(path.resolve(o.appDir), "bin", "memory-audit.mjs");
    if (o.exists(launcher)) return node(launcher);
  }
  // 2. The npm package this CLI came from (`npx memory-audit ui`), when it was built.
  const dist = path.dirname(o.selfFile);
  if (path.basename(dist) === "dist") {
    const pkg = path.resolve(dist, "..", "..");
    const launcher = path.join(pkg, "bin", "memory-audit.mjs");
    if (o.exists(launcher) && o.exists(path.join(pkg, ".next", "BUILD_ID"))) return node(launcher);
  }
  // 3. A globally installed `memory-audit` command.
  const name = win ? "memory-audit.cmd" : "memory-audit";
  const onPath = (o.pathEnv ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((d) => path.join(d, name))
    .find(o.exists);
  if (onPath) return { bin: onPath, args: [], shell: win, label: onPath };
  // 4. Download and run it with npx.
  return { bin: win ? "npx.cmd" : "npx", args: ["--yes", "memory-audit"], shell: win, label: "npx memory-audit" };
}

/** How to stop the detached app. It leads its own process group, so killing the group also stops Next.js. */
export const stopHint = (pid: number | undefined, platform: NodeJS.Platform) =>
  pid === undefined ? "" : platform === "win32" ? `taskkill /PID ${pid} /T /F` : `kill -- -${pid}`;
