// Free checks: run locally, no AI, no network. Each one is a rule a person could verify by hand.

import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { getProject, readAllSessions, readMemory } from "../claude-code/reader";
import type { MemoryFile, SessionDetail, SessionEvent } from "../claude-code/types";
import type { Evidence, Finding, NoteAudit, ProjectAudit, Severity } from "./types";

const RANK: Record<Severity, number> = { ok: 0, info: 1, warn: 2, bad: 3 };
export const worst = (fs: { severity: Severity }[]): Severity =>
  fs.reduce<Severity>((w, f) => (RANK[f.severity] > RANK[w] ? f.severity : w), "ok");

const DAY = 86_400_000;
/** Claude Code only loads the first 200 lines of MEMORY.md into a session. */
const INDEX_LINE_LIMIT = 200;

const CORRECTION =
  /\b(no longer|not anymore|(?:is|that'?s|it'?s) not (?:true|right|correct)|isn'?t (?:true|right|correct)|wrong|incorrect|outdated|out of date|stale|scratch that|never mind|changed (?:to|from)|moved to|switched to|renamed|instead of|we now|not any ?more)\b/i;

/** Text you actually typed: drop pasted blocks and Claude Code's own session summaries. */
export function ownWords(text: string): string {
  if (/^This session is being continued from a previous conversation/.test(text)) return "";
  return text.replace(/<pasted_content\b[^>]*>[\s\S]*?<\/pasted_content>/g, " ").replace(/```[\s\S]*?```/g, " ");
}

const STOP = new Set(
  "about after again also always because been before being between both could does doing don't during each every first from have here into just like make more most much must need never only other over same should some such than that their them then there these they this those through under until using very want were what when where which while with without would your note notes memory user project feedback reference".split(
    " ",
  ),
);

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ""))
    .filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w));

/** Topic words for a note: its name first (most specific), then its description. */
export function keywords(fm: Record<string, string>, file: string): string[] {
  return [...new Set([...nameWords(fm, file), ...words(fm.description ?? "")])].slice(0, 10);
}
export function nameWords(fm: Record<string, string>, file: string): string[] {
  return [...new Set(words(fm.name ?? file.replace(/\.md$/, "")))];
}

export function snippet(text: string, around: string | null, max = 240): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const i = around ? flat.toLowerCase().indexOf(around.toLowerCase()) : -1;
  const start = i < 0 ? 0 : Math.max(0, i - Math.floor(max / 3));
  return `${start > 0 ? "…" : ""}${flat.slice(start, start + max)}${start + max < flat.length ? "…" : ""}`;
}

export function toEvidence(s: SessionDetail, e: SessionEvent, around: string | null = null): Evidence {
  return {
    sessionId: s.id,
    sessionTitle: s.title,
    line: e.index,
    at: e.at,
    who: e.kind === "user" ? "user" : e.kind === "assistant" ? "assistant" : e.kind === "memory_write" ? "memory_write" : "tool",
    quote: e.kind === "memory_write" ? `${e.tool ?? "Write"} ${e.memoryFile}` : snippet(e.text, around),
  };
}

/** Paths a note mentions: absolute, home-relative, or `backticked/relative.ext`. */
export function mentionedPaths(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/(?:^|[\s(`"'])((?:~|\/Users|\/home|\/opt|\/etc|\/var)\/[^\s`"')<>,;]+)/g)) out.add(m[1]);
  // Relative paths only count when they end in a file name with an extension (skips git branches like feat/x).
  for (const m of body.matchAll(/`([A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@[\]-]+)*\/[A-Za-z0-9_@-]+\.[A-Za-z0-9]{1,6})`/g)) out.add(m[1]);
  return [...out]
    .map((p) => p.replace(/[.:]+$/, ""))
    .filter((p) => !/^https?:/.test(p) && !p.includes("*") && !p.includes("<"))
    .slice(0, 20);
}

async function exists(p: string) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function subdirs(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

/** Paths that can't be found. Relative paths are tried in the project folder and one level below it. */
async function missingPaths(body: string, projectPath: string): Promise<string[]> {
  const projectExists = await exists(projectPath);
  const roots = projectExists ? [projectPath, ...(await subdirs(projectPath))] : [];
  const missing: string[] = [];
  for (const p of mentionedPaths(body)) {
    if (p.startsWith("~/") || p.startsWith("/")) {
      if (!(await exists(p.startsWith("~/") ? path.join(homedir(), p.slice(2)) : p))) missing.push(p);
    } else if (roots.length) {
      let found = false;
      for (const r of roots) if ((found = await exists(path.join(r, p)))) break;
      if (!found) missing.push(p);
    }
  }
  return missing;
}

function similarity(a: string, b: string) {
  const sa = new Set(a.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const sb = new Set(b.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  if (sa.size < 3 || sb.size < 3) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

function auditNote(
  m: MemoryFile,
  ctx: {
    sessions: SessionDetail[];
    inIndex: boolean;
    hasIndex: boolean;
    projectPath: string;
    missing: string[];
    others: MemoryFile[];
  },
): NoteAudit {
  const fm = m.frontmatter;
  const findings: Finding[] = [];
  const name = fm.name ?? m.file.replace(/\.md$/, "");

  // 1. Is it loaded at all?
  if (ctx.hasIndex && !ctx.inIndex)
    findings.push({
      code: "not-indexed",
      severity: "warn",
      title: "Not listed in MEMORY.md, so new sessions don't know it exists",
      detail: "Claude only sees notes that the index points to. Either add it to the index or delete it.",
      fix: "add-to-index",
    });

  // 2. Provenance: which conversation wrote it, and is that conversation still on disk?
  const writes: Evidence[] = [];
  for (const s of ctx.sessions)
    for (const e of s.events) if (e.kind === "memory_write" && e.memoryFile === m.file) writes.push(toEvidence(s, e));
  const origin = fm.originSessionId ? ctx.sessions.find((s) => s.id === fm.originSessionId) : undefined;

  if (fm.originSessionId && !origin)
    findings.push({
      code: "origin-deleted",
      severity: "warn",
      title: "The conversation that wrote this note has been deleted",
      detail:
        "Claude Code removes old session logs (after 30 days by default), but notes stay forever. Nothing on disk can confirm this note any more, so treat it as unverified.",
    });
  else if (!fm.originSessionId && writes.length === 0)
    findings.push({
      code: "no-provenance",
      severity: ctx.sessions.length ? "warn" : "info",
      title: "No conversation on disk shows where this note came from",
      detail: ctx.sessions.length
        ? "It may have been written in a session that was later deleted, or edited by hand."
        : "This project has no session logs left to check against.",
    });
  else
    findings.push({
      code: "provenance",
      severity: "ok",
      title: origin ? `Written in “${origin.title}”` : `Written in ${writes.length} logged session${writes.length > 1 ? "s" : ""}`,
      evidence: writes.slice(-5),
    });

  // 3. Age vs. activity since.
  // When the note was last written: its own header, else the newest logged write, else the file time (least reliable).
  const lastWrite = writes.reduce<string | null>((t, w) => (w.at && (!t || w.at > t) ? w.at : t), null);
  const modified = Date.parse(fm.modified ?? lastWrite ?? m.updatedAt);
  if (!Number.isNaN(modified)) {
    const days = Math.floor((Date.now() - modified) / DAY);
    const since = ctx.sessions.filter((s) => s.startedAt && Date.parse(s.startedAt) > modified).length;
    if (days >= 30 && since > 0)
      findings.push({
        code: "old",
        severity: days >= 90 ? "warn" : "info",
        title: `Not updated in ${days} days, while ${since} newer conversation${since > 1 ? "s" : ""} happened`,
        detail: "Old notes in an active project are the most likely to be out of date.",
      });
  }

  // 4. Files and folders it mentions that no longer exist.
  if (ctx.missing.length)
    findings.push({
      code: "missing-paths",
      severity: "warn",
      title: `Mentions ${ctx.missing.length} path${ctx.missing.length > 1 ? "s" : ""} that no longer exist${ctx.missing.length > 1 ? "" : "s"}`,
      detail: ctx.missing.join("\n"),
    });

  // 5. Later messages from you that sound like a correction on the same topic.
  const keys = keywords(fm, m.file);
  const nameKeys = new Set(nameWords(fm, m.file));
  if (keys.length >= 2) {
    const hits: Evidence[] = [];
    for (const s of ctx.sessions) {
      for (const e of s.events) {
        if (e.kind !== "user") continue;
        if (e.at && !Number.isNaN(modified) && Date.parse(e.at) <= modified) continue;
        // A correction = one sentence you wrote with a correction word, two topic words, one from the note's name.
        const sentence = ownWords(e.text)
          .split(/(?<=[.!?\n])\s+/)
          .find((t) => {
            if (!CORRECTION.test(t)) return false;
            const low = t.toLowerCase();
            const matched = keys.filter((k) => low.includes(k));
            return matched.length >= 2 && matched.some((k) => nameKeys.has(k));
          });
        if (sentence) hits.push({ ...toEvidence(s, e), quote: snippet(sentence, null, 280) });
      }
    }
    if (hits.length)
      findings.push({
        code: "possible-correction",
        severity: "warn",
        title: `You may have corrected this topic later (${hits.length} message${hits.length > 1 ? "s" : ""})`,
        detail: `Messages written after the note that mention ${keys.slice(0, 4).join(", ")} together with words like “no longer”, “wrong” or “switched to”. Worth a look; the AI check can confirm.`,
        evidence: hits.slice(-5),
      });
  }

  // 6. Hygiene.
  if (!fm.name || !fm.description || !fm.type)
    findings.push({
      code: "frontmatter",
      severity: "info",
      title: `Missing ${[!fm.name && "name", !fm.description && "description", !fm.type && "type"].filter(Boolean).join(", ")} in the header`,
      detail: "The description is what Claude uses to decide whether a note is relevant.",
    });
  if (!m.body.trim())
    findings.push({ code: "empty", severity: "warn", title: "The note has no content" });

  const dupes = ctx.others.filter(
    (o) => o.file !== m.file && similarity(`${name} ${fm.description ?? ""}`, `${o.frontmatter.name ?? ""} ${o.frontmatter.description ?? ""}`) >= 0.5,
  );
  if (dupes.length)
    findings.push({
      code: "duplicate",
      severity: "info",
      title: `Looks similar to ${dupes.map((d) => d.frontmatter.name ?? d.file).join(", ")}`,
      detail: "Overlapping notes can drift apart and contradict each other. Consider merging them.",
    });

  return { file: m.file, name, status: worst(findings), findings };
}

export async function auditProject(projectId: string): Promise<ProjectAudit> {
  const project = await getProject(projectId);
  const sessions = (await readAllSessions(projectId)).sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
  const hasIndex = project.memory.some((m) => m.isIndex);
  const files = await Promise.all(project.memory.filter((m) => !m.isIndex).map((m) => readMemory(projectId, m.file)));

  const projectFindings: Finding[] = [];
  if (!hasIndex && files.length)
    projectFindings.push({
      code: "no-index",
      severity: "bad",
      title: "There is no MEMORY.md, so none of these notes load automatically",
    });
  if (project.brokenIndexLinks.length)
    projectFindings.push({
      code: "broken-links",
      severity: "bad",
      title:
        project.brokenIndexLinks.length > 1
          ? `MEMORY.md points to ${project.brokenIndexLinks.length} files that don't exist`
          : "MEMORY.md points to a file that doesn't exist",
      detail: project.brokenIndexLinks.join("\n"),
      fix: "remove-broken-links",
    });
  if (hasIndex) {
    const index = await readMemory(projectId, "MEMORY.md");
    const lines = index.raw.split("\n").length;
    if (lines > INDEX_LINE_LIMIT)
      projectFindings.push({
        code: "index-too-long",
        severity: "warn",
        title: `MEMORY.md has ${lines} lines; only the first ${INDEX_LINE_LIMIT} are loaded`,
        detail: "Notes linked below that line are invisible to new sessions.",
      });
  }
  if (!sessions.length && files.length)
    projectFindings.push({
      code: "no-sessions",
      severity: "warn",
      title: "No session logs are left, so no note can be checked against a conversation",
      detail: "Claude Code deletes logs after 30 days by default (setting: cleanupPeriodDays).",
    });

  const notes: NoteAudit[] = [];
  for (const m of files) {
    const s = project.memory.find((x) => x.file === m.file);
    notes.push(
      auditNote(m, {
        sessions,
        inIndex: s?.inIndex ?? false,
        hasIndex,
        projectPath: project.path,
        missing: await missingPaths(m.body, project.path),
        others: files,
      }),
    );
  }
  notes.sort((a, b) => RANK[b.status] - RANK[a.status] || a.name.localeCompare(b.name));

  const counts: Record<Severity, number> = { ok: 0, info: 0, warn: 0, bad: 0 };
  for (const n of notes) counts[n.status] += 1;

  return {
    projectId,
    ranAt: new Date().toISOString(),
    sessionsRead: sessions.length,
    project: projectFindings,
    notes,
    counts,
  };
}
