// Headless Memory Audit for the terminal and the Claude Code plugin. Same checks, results cache and safe
// writer as the web app, so anything done here shows up there (and Undo works from either side).
//
//   memory-audit check [--json]                  quick checks for the current project
//   memory-audit evidence <note>                 the note + related log excerpts, for an in-chat AI check
//   memory-audit save-result <note> <json-file>  validate and save an in-chat verdict (the web UI shows it)
//   memory-audit apply <note> <file> --sha <h>   replace a note (backup first; refused if it changed)
//   memory-audit undo <note>                     restore the most recent backup of a note
//   memory-audit add-to-index <note>             list a note in MEMORY.md so it loads
//   memory-audit remove-broken-links             drop MEMORY.md lines that point to missing notes
//   memory-audit ui                              start the web app (or find it running) and print its URL
//
// Every command takes --project <id-or-path>; by default the project is the current folder.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { diffLines } from "../diff";
import { auditProject } from "../audit/checks";
import { buildContext, JSON_SHAPE, lastResult, Output, saveResult, SYSTEM, toResult } from "../audit/evidence";
import type { NoteAudit, Severity } from "../audit/types";
import { addToIndex, ConflictError, listBackups, removeBrokenLinks, restoreBackup, sha, writeNote } from "../audit/writer";
import { pickLauncher, stopHint } from "./launcher";
import { BadRequestError, listProjects, NotFoundError, projectsRoot, readMemory } from "../claude-code/reader";

class UsageError extends Error {}

const argv = process.argv.slice(2);
const flags = new Map<string, string | true>();
const pos: string[] = [];
const VALUE_FLAGS = ["--project", "--sha", "--port"];
const KNOWN_FLAGS = [...VALUE_FLAGS, "--json", "--readonly", "--help"];
const unknownFlags: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const [a, inline] = argv[i].startsWith("--") && argv[i].includes("=") ? [argv[i].slice(0, argv[i].indexOf("=")), argv[i].slice(argv[i].indexOf("=") + 1)] : [argv[i], undefined];
  if (a.startsWith("--")) {
    // An unknown flag could mean the command acts on the wrong note or project, so it is an error (see run()).
    if (!KNOWN_FLAGS.includes(a)) unknownFlags.push(a);
    const next = argv[i + 1];
    if (inline !== undefined) flags.set(a, inline);
    else if (next !== undefined && !next.startsWith("--") && VALUE_FLAGS.includes(a)) flags.set(a, argv[++i]);
    else flags.set(a, true);
  } else pos.push(a);
}
const [cmd, ...args] = pos;
const opt = (k: string) => (typeof flags.get(k) === "string" ? (flags.get(k) as string) : undefined);
const out = (s = "") => process.stdout.write(`${s}\n`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ───────────── Which project? ─────────────

/** Claude Code names a project's folder after its path, with every character that isn't a letter or digit turned into "-". */
const encode = (p: string) => p.replace(/[^A-Za-z0-9]/g, "-");

async function resolveProject(): Promise<{ id: string; path: string }> {
  const given = opt("--project");
  const root = projectsRoot();
  const projects = await listProjects();
  // A project id is a single folder name; ".", ".." and anything with a separator is a path.
  if (given && !/[\\/]/.test(given) && given !== "." && given !== ".." && existsSync(path.join(root, given)))
    return { id: given, path: projects.find((p) => p.id === given)?.path ?? given };
  const start = path.resolve(given ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  const home = homedir();
  // Walk up from the folder so a session started in a subfolder still finds its project, but never up to
  // your home folder: a new folder inside it must not silently use (and edit) the home folder's memory.
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (dir === home && start !== home) break;
    const id = encode(dir);
    const match = existsSync(path.join(root, id)) ? { id } : projects.find((p) => p.path === dir);
    if (match) {
      if (dir !== start) process.stderr.write(`memory-audit: using the project for ${dir} (there is none for ${start}).\n`);
      return { id: match.id, path: dir };
    }
    if (path.dirname(dir) === dir) break;
  }
  throw new NotFoundError(
    `No Claude Code project found for ${start}. Pass --project <id>; ids are the folder names in ${root}.`,
  );
}

function noteArg(i = 0) {
  const f = args[i];
  if (!f) throw new UsageError("Name the note, e.g. `memory-audit evidence my-note.md`.");
  return path.basename(f.endsWith(".md") ? f : `${f}.md`);
}

// ───────────── Commands ─────────────

const ICON: Record<Severity, string> = { bad: "✗", warn: "!", info: "·", ok: "✓" };
const WORD: Record<Severity, string> = { bad: "problem", warn: "warning", info: "note", ok: "ok" };

async function check() {
  const project = await resolveProject();
  const audit = await auditProject(project.id);
  const results = new Map(
    await Promise.all(audit.notes.map(async (n) => [n.file, await lastResult(project.id, n.file)] as const)),
  );
  if (flags.has("--json")) {
    out(JSON.stringify({ ...audit, aiResults: Object.fromEntries(results) }, null, 2));
    return;
  }

  out(`Memory Audit · ${project.path}`);
  out(`${plural(audit.notes.length, "note")}, ${plural(audit.sessionsRead, "session log")} read · project id ${project.id}`);
  out();
  for (const f of audit.project) {
    out(`${ICON[f.severity]} [${WORD[f.severity]}] MEMORY.md: ${f.title}${f.fix ? `  (fix: ${f.fix})` : ""}`);
    if (f.detail) out(indent(f.detail));
  }
  if (audit.project.length) out();

  const order: Severity[] = ["bad", "warn", "info", "ok"];
  const notes = [...audit.notes].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.file.localeCompare(b.file));
  const flagged = notes.filter((n) => n.status === "bad" || n.status === "warn");
  for (const n of flagged) printNote(n, results.get(n.file) ?? null);
  const quiet = notes.filter((n) => n.status === "info" || n.status === "ok");
  if (quiet.length) {
    out(`✓ ${quiet.length} note${quiet.length > 1 ? "s" : ""} with no warning signs:`);
    for (const n of quiet) {
      const ai = results.get(n.file);
      out(`  ${n.file}${ai ? `  (AI check: ${ai.verdict}, ${ai.ranAt.slice(0, 10)})` : ""}`);
    }
  }
  if (!audit.notes.length) out("This project has no memory notes yet.");
  out();
  out(`Notes: ${audit.counts.bad} with problems, ${audit.counts.warn} with warnings, ${audit.counts.info + audit.counts.ok} fine.`);
  out("Quick checks only flag warning signs; an AI check decides whether a note is actually true.");
}

function printNote(n: NoteAudit, ai: Awaited<ReturnType<typeof lastResult>>) {
  out(`${ICON[n.status]} [${WORD[n.status]}] ${n.file}${n.name !== n.file ? ` (${n.name})` : ""}`);
  for (const f of n.findings.filter((f) => f.severity !== "ok")) {
    out(`    - ${f.title}${f.fix ? `  (fix: ${f.fix})` : ""}`);
    for (const e of f.evidence?.slice(0, 2) ?? []) out(`      “${e.quote.replace(/\s+/g, " ").slice(0, 160)}” (${e.who}, ${e.at?.slice(0, 10) ?? "?"})`);
  }
  if (ai) out(`    AI check (${ai.ranAt.slice(0, 10)}): ${ai.verdict}. ${ai.summary}`);
  out();
}

const indent = (s: string) => s.split("\n").map((l) => `    ${l}`).join("\n");

async function evidence() {
  const project = await resolveProject();
  const file = noteArg();
  const ctx = await buildContext(project.id, file);
  const sessions = new Set(ctx.excerpts.map((x) => x.session.id)).size;
  out(`<memory_audit_evidence project="${project.id}" note="${file}" note_sha="${sha(ctx.note.raw)}" excerpts="${ctx.excerpts.length}" sessions="${sessions}">`);
  out("<instructions>");
  out(SYSTEM);
  out();
  out(JSON_SHAPE);
  out("</instructions>");
  out();
  out(ctx.user);
  out("</memory_audit_evidence>");
}

async function readInput(p: string | undefined) {
  if (!p || p === "-") {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  }
  return readFile(path.resolve(p), "utf8");
}

async function saveResultCmd() {
  const project = await resolveProject();
  const file = noteArg();
  const text = await readInput(args[1]);
  let parsed;
  try {
    parsed = Output.safeParse(JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "")));
  } catch (e) {
    throw new UsageError(`That isn't valid JSON: ${(e as Error).message}`);
  }
  if (!parsed.success) throw new UsageError(`The verdict doesn't have the expected shape:\n${parsed.error.message}`);
  const ctx = await buildContext(project.id, file);
  const { droppedCitations, downgradedClaims, ...result } = toResult(ctx, file, parsed.data, {
    provider: "claude-code",
    model: "Claude Code session (memory-audit plugin)",
    inputTokens: 0,
    outputTokens: 0,
    costUsd: null,
  });
  await saveResult(project.id, result);

  out(`Saved. Verdict: ${result.verdict} (${result.confidence} confidence). The web UI now shows this result too.`);
  if (droppedCitations)
    out(`Dropped ${droppedCitations} citation${droppedCitations > 1 ? "s" : ""} that didn't match a real log line.`);
  if (downgradedClaims)
    out(
      `${downgradedClaims} claim${downgradedClaims > 1 ? "s were" : " was"} left with no real citation, so ${downgradedClaims > 1 ? "they count" : "it counts"} as unverified.`,
    );
  for (const r of result.reasons)
    out(`  ${r.status.padEnd(12)} ${r.claim}${r.evidence.length ? `  [${r.evidence.map((e) => `“${e.sessionTitle.slice(0, 40)}” line ${e.line}`).join("; ")}]` : ""}`);
  if (result.proposedRaw) {
    out();
    out(`Proposed fix (note_sha ${sha(ctx.note.raw)}):`);
    out(unified(ctx.note.raw, result.proposedRaw));
  } else out("No fix proposed: nothing in the logs shows the note is out of date or wrong.");
}

function unified(a: string, b: string) {
  return diffLines(a, b)
    .map((l) => (l.kind === "add" ? `+ ${l.text}` : l.kind === "del" ? `- ${l.text}` : `  ${l.text}`))
    .join("\n");
}

async function apply() {
  const project = await resolveProject();
  const file = noteArg();
  const expected = opt("--sha");
  if (!expected) throw new UsageError("Pass --sha <note_sha> from the version you reviewed, so a newer edit is never overwritten.");
  let next = await readInput(args[1]);
  if (!next.trim()) throw new UsageError("The new note is empty.");
  next = next.replace(/\s*$/, "\n");
  // apply only replaces a note you reviewed; a mistyped name must not create a new one.
  const current = await readMemory(project.id, file).catch(() => null);
  if (!current) throw new NotFoundError(`${file} doesn't exist in this project. Check the name with \`memory-audit check\`.`);
  const r = await writeNote(project.id, file, next, expected, "Edited from Claude Code (memory-audit plugin)");
  out(`Updated ${file}.`);
  out(unified(current.raw, next));
  // Replacing an existing note always backs it up first.
  out(`Backup: ${r.backup!.id}. Undo with \`memory-audit undo ${file}\` or the Undo button in the web UI.`);
}

async function undo() {
  const project = await resolveProject();
  const file = noteArg();
  const [latest] = await listBackups(project.id, file);
  if (!latest) throw new NotFoundError(`${file} has no backups, so there's nothing to undo.`);
  const r = await restoreBackup(project.id, file, latest.id);
  out(`Restored ${file} to the version from ${latest.createdAt} (before: ${latest.reason}).`);
  if (r.backup) out(`The version you just replaced is backed up too (${r.backup.id}), so this can be undone the same way.`);
}

async function addToIndexCmd() {
  const project = await resolveProject();
  const file = noteArg();
  await readMemory(project.id, file); // clear "not found" before touching MEMORY.md
  const r = await addToIndex(project.id, file);
  out(`${file} is listed in MEMORY.md, so new sessions will load it.${r.backup ? ` Backup of the old index: ${r.backup.id}.` : ""}`);
}

async function removeBrokenLinksCmd() {
  const project = await resolveProject();
  const r = await removeBrokenLinks(project.id);
  if (!r.removed.length) return out("MEMORY.md has no links to missing notes.");
  out(`Removed ${r.removed.length} line${r.removed.length > 1 ? "s" : ""} from MEMORY.md:`);
  for (const l of r.removed) out(`  ${l}`);
}

async function ui() {
  const port = opt("--port") ?? "3210";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new UsageError("--port must be a number from 1 to 65535.");
  const url = `http://127.0.0.1:${port}`;
  // "ours" only when the page is Memory Audit, so another app on the port isn't mistaken for it.
  const probe = async (): Promise<"ours" | "other" | "down"> => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
      return r.ok && (await r.text()).includes("<title>Memory Audit") ? "ours" : "other";
    } catch {
      return "down";
    }
  };
  const before = await probe();
  if (before === "ours") {
    out(`Memory Audit is already running: ${url}`);
    if (flags.has("--readonly"))
      out("It was started earlier, so --readonly doesn't apply to it. To be sure it can't write, stop it and run this again.");
    return;
  }
  if (before === "other") throw new UsageError(`Another app is using port ${port}. Pick a free one with --port, e.g. --port ${Number(port) + 1}.`);

  const launch = pickLauncher({
    appDir: process.env.MEMORY_AUDIT_APP_DIR,
    selfFile: fileURLToPath(import.meta.url),
    pathEnv: process.env.PATH,
    platform: process.platform,
    exists: existsSync,
    execPath: process.execPath,
  });
  const logDir = path.join(homedir(), ".memory-audit");
  mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, "ui.log");
  const log = openSync(logFile, "a");
  const extra = flags.has("--readonly") ? ["--readonly"] : [];
  const app = spawn(launch.bin, [...launch.args, "--port", port, "--no-open", ...extra], {
    detached: true,
    shell: launch.shell,
    windowsHide: true,
    stdio: ["ignore", log, log],
  });
  // If the launcher gives up (e.g. npx can't download the package), say so now instead of waiting out the timeout.
  let exited: number | null | undefined;
  app.on("exit", (code) => (exited = code));
  app.on("error", () => (exited = -1));
  app.unref();

  for (let i = 0; i < 90; i++) {
    if (exited !== undefined)
      throw new UsageError(
        `Memory Audit couldn't start (${launch.label} exited). See ${logFile}.\n` +
          "Check your network connection, or install it once with `npm install -g memory-audit`.",
      );
    if ((await probe()) === "ours") {
      const stop = stopHint(app.pid, process.platform);
      return out(`Memory Audit is running: ${url}\nIt keeps running in the background${stop ? `; stop it with \`${stop}\`` : ""}.`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new UsageError(
    `Memory Audit is still starting after 90 seconds (the first run downloads it, which can be slow). ` +
      `Run \`memory-audit ui\` again in a minute. Log: ${logFile}`,
  );
}

const HELP = `memory-audit: check your Claude Code memory notes against your own session logs.

  memory-audit                               open the web app (same as before)
  memory-audit check [--json]                quick checks for the current project
  memory-audit evidence <note>               the note plus related log excerpts, for an AI check in chat
  memory-audit save-result <note> [file|-]   save an in-chat verdict so the web UI shows it
  memory-audit apply <note> [file|-] --sha <note_sha>
                                             replace a note (backed up first; refused if it changed)
  memory-audit undo <note>                   restore a note's most recent backup
  memory-audit add-to-index <note>           list a note in MEMORY.md so new sessions load it
  memory-audit remove-broken-links           drop MEMORY.md lines that point to missing notes
  memory-audit ui [--port 3210]              start the web app in the background and print its URL

  --project <id or path>   which project (default: the current folder)`;

const COMMANDS: Record<string, () => Promise<unknown>> = {
  check,
  evidence,
  "save-result": saveResultCmd,
  apply,
  undo,
  "add-to-index": addToIndexCmd,
  "remove-broken-links": removeBrokenLinksCmd,
  ui,
};

async function main() {
  if (!cmd || cmd === "help" || flags.has("--help")) return out(HELP);
  const run = COMMANDS[cmd];
  if (!run) throw new UsageError(`Unknown command "${cmd}".\n\n${HELP}`);
  if (unknownFlags.length) throw new UsageError(`Unknown option ${unknownFlags[0]}. Options: ${KNOWN_FLAGS.join(", ")}.`);
  await run();
}

/** Settles when the command has finished (the tests await it). */
export const done = main().catch((e: Error) => {
  const known = e instanceof UsageError || e instanceof NotFoundError || e instanceof BadRequestError || e instanceof ConflictError;
  process.stderr.write(`memory-audit: ${known ? e.message : (e.stack ?? e.message)}\n`);
  process.exit(known ? 2 : 1);
});
