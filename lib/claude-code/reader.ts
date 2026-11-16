// Read-only access to Claude Code's local memory and session logs.
//
// Layout on disk (one folder per project):
//   ~/.claude/projects/<project-id>/memory/MEMORY.md     index loaded at every session start
//   ~/.claude/projects/<project-id>/memory/*.md          one note per file
//   ~/.claude/projects/<project-id>/<session-id>.jsonl   full log of one session
//
// Nothing in this module writes to disk (writes live in lib/audit/writer.ts).

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type {
  MemoryFile,
  MemoryFileSummary,
  ProjectDetail,
  ProjectSummary,
  SessionDetail,
  SessionEvent,
  SessionSummary,
} from "./types";

export class NotFoundError extends Error {}
export class BadRequestError extends Error {}

export function projectsRoot(): string {
  return path.resolve(process.env.MEMORY_AUDIT_CLAUDE_DIR ?? path.join(homedir(), ".claude", "projects"));
}

/** Resolve a single path segment inside `base`, refusing anything that could escape it. */
export function child(base: string, name: string): string {
  if (!name || name === "." || name === ".." || /[/\\\0]/.test(name)) throw new BadRequestError("Invalid name");
  const p = path.resolve(base, name);
  if (path.dirname(p) !== base) throw new BadRequestError("Invalid name");
  return p;
}

async function statOrNull(p: string) {
  try {
    return await stat(p);
  } catch {
    return null;
  }
}

async function listDir(p: string) {
  try {
    return await readdir(p, { withFileTypes: true });
  } catch {
    return [];
  }
}

// ───────────── Session scanning (cached by mtime + size) ─────────────

interface SessionScan {
  title: string | null;
  cwd: string | null;
  startedAt: string | null;
  endedAt: string | null;
  messageCount: number;
  lines: string[];
}

const scanCache = new Map<string, { key: string; scan: SessionScan }>();

async function scanSession(file: string): Promise<SessionScan> {
  const s = await stat(file);
  const key = `${s.mtimeMs}:${s.size}`;
  const hit = scanCache.get(file);
  if (hit && hit.key === key) return hit.scan;

  const lines = (await readFile(file, "utf8")).split("\n");
  let customTitle: string | null = null;
  let aiTitle: string | null = null;
  let firstPrompt: string | null = null;
  let cwd: string | null = null;
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let messageCount = 0;

  for (const line of lines) {
    if (!line) continue;
    let d: Record<string, unknown>;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof d.timestamp === "string") {
      startedAt ??= d.timestamp;
      endedAt = d.timestamp;
    }
    if (!cwd && typeof d.cwd === "string") cwd = d.cwd;
    if (d.type === "custom-title" && typeof d.customTitle === "string") customTitle = d.customTitle;
    if (d.type === "ai-title" && typeof d.aiTitle === "string") aiTitle = d.aiTitle;
    if ((d.type === "user" || d.type === "assistant") && !d.isMeta && !d.isSidechain) {
      const ev = toEvents(d, 0);
      if (ev.some((e) => e.kind === "user" || e.kind === "assistant")) messageCount += 1;
      if (!firstPrompt) firstPrompt = ev.find((e) => e.kind === "user")?.text.slice(0, 80) ?? null;
    }
  }

  const scan = { title: customTitle ?? aiTitle ?? firstPrompt, cwd, startedAt, endedAt, messageCount, lines };
  scanCache.set(file, { key, scan });
  return scan;
}

// ───────────── Projects ─────────────

async function sessionFiles(dir: string) {
  return (await listDir(dir)).filter((e) => e.isFile() && e.name.endsWith(".jsonl")).map((e) => e.name);
}

async function memoryFiles(dir: string) {
  return (await listDir(path.join(dir, "memory"))).filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name);
}

/** Folder names replace "/" with "-", which is ambiguous; prefer the real cwd recorded in a log. */
function guessPath(id: string) {
  return id.replace(/-/g, "/");
}

async function summarize(id: string): Promise<ProjectSummary> {
  const dir = child(projectsRoot(), id);
  const [sessions, memory] = await Promise.all([sessionFiles(dir), memoryFiles(dir)]);
  let cwd: string | null = null;
  let updated = 0;
  for (const f of sessions) {
    const s = await statOrNull(path.join(dir, f));
    if (s) updated = Math.max(updated, s.mtimeMs);
    if (!cwd) cwd = (await scanSession(path.join(dir, f)).catch(() => null))?.cwd ?? null;
  }
  for (const f of memory) {
    const s = await statOrNull(path.join(dir, "memory", f));
    if (s) updated = Math.max(updated, s.mtimeMs);
  }
  const p = cwd ?? guessPath(id);
  return {
    id,
    name: path.basename(p) || id,
    path: p,
    memoryCount: memory.filter((f) => f !== "MEMORY.md").length,
    sessionCount: sessions.length,
    updatedAt: updated ? new Date(updated).toISOString() : null,
  };
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const root = projectsRoot();
  const dirs = (await listDir(root)).filter((e) => e.isDirectory()).map((e) => e.name);
  const all = await Promise.all(dirs.map((d) => summarize(d).catch(() => null)));
  return all
    .filter((p): p is ProjectSummary => p !== null)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export async function getProject(id: string): Promise<ProjectDetail> {
  const dir = child(projectsRoot(), id);
  if (!(await statOrNull(dir))?.isDirectory()) throw new NotFoundError("Project not found");
  const summary = await summarize(id);
  const memDir = path.join(dir, "memory");

  const index = (await readFile(path.join(memDir, "MEMORY.md"), "utf8").catch(() => "")) || "";
  const linked = new Set([...index.matchAll(/\]\(([^)\s]+\.md)\)/g)].map((m) => path.basename(m[1])));

  const names = await memoryFiles(dir);
  const memory: MemoryFileSummary[] = await Promise.all(
    names.map(async (file) => {
      const p = path.join(memDir, file);
      const [s, raw] = await Promise.all([stat(p), readFile(p, "utf8")]);
      const { frontmatter } = parseFrontmatter(raw);
      return {
        file,
        isIndex: file === "MEMORY.md",
        name: frontmatter.name ?? null,
        description: frontmatter.description ?? null,
        type: frontmatter.type ?? null,
        size: s.size,
        updatedAt: s.mtime.toISOString(),
        inIndex: linked.has(file),
      };
    }),
  );
  memory.sort((a, b) => Number(b.isIndex) - Number(a.isIndex) || a.file.localeCompare(b.file));

  const sessions: SessionSummary[] = await Promise.all(
    (await sessionFiles(dir)).map(async (f) => {
      const p = path.join(dir, f);
      const [s, scan] = await Promise.all([stat(p), scanSession(p)]);
      const id = f.replace(/\.jsonl$/, "");
      return {
        id,
        title: scan.title ?? id.slice(0, 8),
        size: s.size,
        updatedAt: s.mtime.toISOString(),
        startedAt: scan.startedAt,
        messageCount: scan.messageCount,
      };
    }),
  );
  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return {
    ...summary,
    memoryDir: memDir,
    memory,
    sessions,
    brokenIndexLinks: [...linked].filter((f) => !names.includes(f)),
  };
}

// ───────────── Memory notes ─────────────

/** Minimal frontmatter reader: `key: value` lines, with one level of nesting flattened. */
export function parseFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { frontmatter: {}, body: raw };
  const fm: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^\s*([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv && kv[2]) {
      let v = kv[2].trim();
      if (/^".*"$/.test(v)) v = v.slice(1, -1).replace(/\\(["\\])/g, "$1");
      else if (/^'.*'$/.test(v)) v = v.slice(1, -1).replace(/''/g, "'");
      fm[kv[1]] = v;
    }
  }
  return { frontmatter: fm, body: raw.slice(m[0].length) };
}

export async function readMemory(projectId: string, file: string): Promise<MemoryFile> {
  if (!file.endsWith(".md")) throw new BadRequestError("Only .md notes can be read");
  const memDir = path.join(child(projectsRoot(), projectId), "memory");
  const p = child(memDir, file);
  const s = await statOrNull(p);
  if (!s?.isFile()) throw new NotFoundError("Note not found");
  const raw = await readFile(p, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw);
  return {
    file,
    absolutePath: p,
    frontmatter,
    body,
    raw,
    updatedAt: s.mtime.toISOString(),
    sha: createHash("sha256").update(raw).digest("hex"),
  };
}

// ───────────── Sessions ─────────────

// Wrapper blocks Claude Code injects into user turns; they are context, not what the person typed.
const INJECTED =
  /<(system-reminder|browser_instruction|ide_opened_file|ide_selection|command-message|command-name|command-args|local-command-stdout|local-command-caveat)\b[^>]*>[\s\S]*?<\/\1>/g;

const MAX_TEXT = 4000;

function clip(s: string): { text: string; truncated: boolean } {
  return s.length > MAX_TEXT ? { text: s.slice(0, MAX_TEXT), truncated: true } : { text: s, truncated: false };
}

function toolSummary(name: string, input: Record<string, unknown>): string {
  const pick = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : null);
  const parts = [
    pick("description"),
    pick("command") ?? pick("file_path") ?? pick("skill") ?? pick("url") ?? pick("query") ?? pick("pattern"),
  ].filter(Boolean);
  if (parts.length === 0) {
    const p = pick("prompt");
    if (p) parts.push(p);
  }
  return parts.length ? parts.join("\n") : JSON.stringify(input).slice(0, 300);
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : "[non-text content]"))
      .join("\n");
  return "";
}

function toEvents(d: Record<string, unknown>, index: number): SessionEvent[] {
  const at = typeof d.timestamp === "string" ? d.timestamp : null;
  const msg = d.message as { content?: unknown } | undefined;
  const content = msg?.content;
  const out: SessionEvent[] = [];

  if (d.type === "user") {
    if (d.isMeta) {
      const t = resultText(content).trim();
      if (t) out.push({ index, kind: "context", at, text: t.split("\n")[0].slice(0, 200) });
      return out;
    }
    const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
    const typed: string[] = [];
    for (const b of blocks as Record<string, unknown>[]) {
      if (b.type === "text" && typeof b.text === "string") {
        const t = b.text.replace(INJECTED, "").trim();
        if (t) typed.push(t);
      } else if (b.type === "tool_result") {
        out.push({ index, kind: "tool_result", at, isError: b.is_error === true, ...clip(resultText(b.content)) });
      }
    }
    if (typed.length) out.unshift({ index, kind: "user", at, ...clip(typed.join("\n\n")) });
    return out;
  }

  if (d.type === "assistant" && Array.isArray(content)) {
    for (const b of content as Record<string, unknown>[]) {
      if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
        out.push({ index, kind: "assistant", at, ...clip(b.text) });
      } else if (b.type === "tool_use") {
        const name = String(b.name ?? "tool");
        const input = (b.input ?? {}) as Record<string, unknown>;
        const fp = typeof input.file_path === "string" ? input.file_path : "";
        const isMemory = (name === "Write" || name === "Edit") && /[/\\]memory[/\\][^/\\]+\.md$/.test(fp);
        out.push({
          index,
          kind: isMemory ? "memory_write" : "tool_use",
          at,
          tool: name,
          memoryFile: isMemory ? path.basename(fp) : undefined,
          ...clip(toolSummary(name, input)),
        });
      }
    }
  }
  return out;
}

export async function readSession(projectId: string, sessionId: string): Promise<SessionDetail> {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) throw new BadRequestError("Invalid session id");
  const p = child(child(projectsRoot(), projectId), `${sessionId}.jsonl`);
  if (!(await statOrNull(p))?.isFile()) throw new NotFoundError("Session not found");
  const scan = await scanSession(p);

  const events: SessionEvent[] = [];
  let skipped = 0;
  let lineCount = 0;
  scan.lines.forEach((line, i) => {
    if (!line) return;
    lineCount += 1;
    let d: Record<string, unknown>;
    try {
      d = JSON.parse(line);
    } catch {
      skipped += 1;
      return;
    }
    if (d.isSidechain) {
      skipped += 1;
      return;
    }
    const ev = toEvents(d, i + 1);
    if (ev.length === 0) skipped += 1;
    events.push(...ev);
  });

  return {
    id: sessionId,
    title: scan.title ?? sessionId.slice(0, 8),
    absolutePath: p,
    startedAt: scan.startedAt,
    endedAt: scan.endedAt,
    lineCount,
    skippedLines: skipped,
    events,
  };
}

/** Memory folder of a project, validated. */
export function memoryDirOf(projectId: string): string {
  return path.join(child(projectsRoot(), projectId), "memory");
}

/** Every session of a project, parsed (cached by file mtime + size). */
export async function readAllSessions(projectId: string): Promise<SessionDetail[]> {
  const dir = child(projectsRoot(), projectId);
  const files = await sessionFiles(dir);
  const out = await Promise.all(files.map((f) => readSession(projectId, f.replace(/\.jsonl$/, "")).catch(() => null)));
  return out.filter((s): s is SessionDetail => s !== null);
}
