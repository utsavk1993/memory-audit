#!/usr/bin/env node
// Start Memory Audit on this machine and open it in the browser.
//   npx memory-audit [--port 3210] [--no-open] [--readonly]

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

if (flag("--help") || flag("-h")) {
  console.log(`Memory Audit: inspect and fix your Claude Code memory notes.

Usage: npx memory-audit [options]

  --port <n>     Port to listen on (default 3210)
  --no-open      Don't open the browser
  --readonly     Never write to your memory folder

Environment:
  ANTHROPIC_API_KEY         AI check with Claude
  NVIDIA_API_KEY            AI check with NVIDIA Nemotron
  MEMORY_AUDIT_CLAUDE_DIR   Projects folder (default ~/.claude/projects)
  MEMORY_AUDIT_MODEL        Model for the AI check (default claude-opus-5-5)`);
  process.exit(0);
}

const port = value("--port", process.env.PORT ?? "3210");
if (!/^\d+$/.test(port)) {
  console.error("--port must be a number");
  process.exit(1);
}
if (!existsSync(path.join(root, ".next", "BUILD_ID"))) {
  console.error("Memory Audit isn't built. From a source checkout, run `npm run build` first.");
  process.exit(1);
}

const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
if (flag("--readonly")) env.MEMORY_AUDIT_READONLY = "1";

// Always bind to loopback: the app reads private files.
const child = spawn(process.execPath, [next, "start", "-H", "127.0.0.1", "-p", port], { cwd: root, env, stdio: ["inherit", "pipe", "inherit"] });

const url = `http://127.0.0.1:${port}`;
let opened = false;
child.stdout.on("data", (buf) => {
  const text = buf.toString();
  if (!opened && /ready|started|Local:/i.test(text)) {
    opened = true;
    console.log(`\n  Memory Audit is running at ${url}\n  Local only. Press Ctrl+C to stop.\n`);
    if (!flag("--no-open")) {
      const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
      spawn(cmd, [url], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
    }
  }
});

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
