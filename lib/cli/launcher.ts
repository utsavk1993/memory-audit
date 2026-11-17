// How `memory-audit ui` starts the web app. Kept separate from main.ts so every case can be tested
// without depending on how or where the CLI itself is installed.

import path from "node:path";

export interface Launch {
  bin: string;
  args: string[];
  /** Only for the last-resort `npx.cmd` on Windows, which can't be started without a shell. */
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
  // Running a launcher with Node directly needs no shell, so paths with spaces ("C:\Users\Jane Doe") just work.
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
  // 3. A global install (`npm install -g memory-audit`). On Windows the command on PATH is a .cmd shim, so
  //    run the launcher it points to (<prefix>\node_modules\memory-audit\bin) with Node instead.
  for (const dir of (o.pathEnv ?? "").split(path.delimiter).filter(Boolean)) {
    if (!win && o.exists(path.join(dir, "memory-audit"))) {
      const bin = path.join(dir, "memory-audit");
      return { bin, args: [], shell: false, label: bin };
    }
    const launcher = path.join(dir, "node_modules", "memory-audit", "bin", "memory-audit.mjs");
    if (win && o.exists(path.join(dir, "memory-audit.cmd")) && o.exists(launcher)) return node(launcher);
  }
  // 4. Download and run it with npx: through the npx script that ships next to Node when it's there,
  //    otherwise (Windows only) npx.cmd through a shell.
  const npxCli = path.join(path.dirname(o.execPath), "node_modules", "npm", "bin", "npx-cli.js");
  if (win && o.exists(npxCli)) return { bin: o.execPath, args: [npxCli, "--yes", "memory-audit"], shell: false, label: "npx memory-audit" };
  return { bin: win ? "npx.cmd" : "npx", args: ["--yes", "memory-audit"], shell: win, label: "npx memory-audit" };
}

/**
 * The arguments for spawn(). With a shell, Node wants one command string (passing an args array with
 * `shell: true` is deprecated and unescaped); every part here is a fixed word or a validated port number.
 */
export function spawnCommand(l: Launch, extra: string[]): [string, string[]] {
  return l.shell ? [[l.bin, ...l.args, ...extra].join(" "), []] : [l.bin, [...l.args, ...extra]];
}

/** How to stop the detached app. It leads its own process group, so killing the group also stops Next.js. */
export const stopHint = (pid: number | undefined, platform: NodeJS.Platform) =>
  pid === undefined ? "" : platform === "win32" ? `taskkill /PID ${pid} /T /F` : `kill -- -${pid}`;

/** How to compare two paths on this platform: macOS and Windows file systems ignore case by default. */
export const pathKey = (platform: NodeJS.Platform) => (p: string) => (platform === "darwin" || platform === "win32" ? p.toLowerCase() : p);
