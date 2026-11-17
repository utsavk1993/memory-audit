#!/usr/bin/env node
// Start Memory Audit on this machine and open it in the browser.
//   npx memory-audit [--port 3210] [--no-open] [--readonly] [--version]

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// `--port=4000` means the same as `--port 4000` (the terminal commands accept both forms too).
const args = process.argv.slice(2).flatMap((a) => (a.startsWith("--port=") ? ["--port", a.slice(7)] : [a]));
const flag = (n) => args.includes(n);
const value = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

// Terminal commands (check, evidence, apply, …) live in the headless CLI the Claude Code plugin ships with.
const COMMANDS = ["check", "evidence", "save-result", "apply", "undo", "add-to-index", "remove-broken-links", "ui", "help"];
if (args[0] && COMMANDS.includes(args[0])) {
  const cli = spawn(process.execPath, [path.join(root, "plugin", "dist", "cli.mjs"), ...args], { stdio: "inherit" });
  cli.on("exit", (code) => process.exit(code ?? 1));
} else main();

// Resolves true when nothing is listening on 127.0.0.1:<port>.
function portFree(port) {
  return new Promise((resolve) => {
    const srv = createServer()
      .once("error", () => resolve(false))
      .once("listening", () => srv.close(() => resolve(true)));
    srv.listen(Number(port), "127.0.0.1");
  });
}

async function main() {
if (flag("--version") || flag("-v")) {
  console.log(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version);
  process.exit(0);
}

const KNOWN = ["--port", "--no-open", "--readonly", "--help", "-h"];
const unknown = args.filter((a, i) => !KNOWN.includes(a) && args[i - 1] !== "--port");
if (unknown.length) {
  console.error(`Unknown option: ${unknown[0]}\nRun \`npx memory-audit --help\` for options, or \`npx memory-audit help\` for terminal commands.`);
  process.exit(1);
}

if (flag("--help") || flag("-h")) {
  console.log(`Memory Audit: inspect and fix your Claude Code memory notes.

Usage: npx memory-audit [options]
       npx memory-audit <command>    terminal commands; see \`npx memory-audit help\`

  --port <n>     Port to listen on (default 3210)
  --no-open      Don't open the browser
  --readonly     Never write to your memory folder
  --version      Print the version

Environment (all optional; see the README for the full list):
  MEMORY_AUDIT_PROVIDER       claude-code (default when installed), anthropic or nvidia
  ANTHROPIC_API_KEY           key for the anthropic provider
  NVIDIA_API_KEY              key for the nvidia provider
  MEMORY_AUDIT_CLAUDE_MODEL   model for the claude-code provider (default: your Claude Code default)
  MEMORY_AUDIT_MODEL          model for the anthropic provider (default claude-opus-5-5)
  MEMORY_AUDIT_CLAUDE_DIR     projects folder (default ~/.claude/projects, or $CLAUDE_CONFIG_DIR/projects)`);
  process.exit(0);
}

const port = value("--port", "3210");
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  console.error("--port must be a number from 1 to 65535");
  process.exit(1);
}
if (!(await portFree(port))) {
  console.error(`Port ${port} is already in use.
  If Memory Audit is already running, open http://127.0.0.1:${port}
  Otherwise start it on another port: npx memory-audit --port ${Number(port) < 65535 ? Number(port) + 1 : Number(port) - 1}`);
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
}
