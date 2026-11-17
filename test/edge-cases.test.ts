// Edge cases in parsing, writing and request guards that the scenario tests don't reach.

import { chmodSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditProject } from "@/lib/audit/checks";
import { buildContext } from "@/lib/audit/evidence";
import { addToIndex, backupsRoot, listBackups, readBackup, removeBrokenLinks, restoreBackup, sha, writeNote } from "@/lib/audit/writer";
import { BadRequestError, NotFoundError, child, getProject, listProjects, projectsRoot, readSession, readAllSessions } from "@/lib/claude-code/reader";
import { ForbiddenError, guardedJson } from "@/lib/claude-code/respond";
import { diffLines, markUnverified } from "@/lib/diff";
import { proxy } from "@/proxy";
import { PROJECT, note, sandbox, type Sandbox } from "./fixtures";

let sb: Sandbox;
beforeEach(() => (sb = sandbox()));
afterEach(() => sb.cleanup());

describe("defaults", () => {
  it("reads ~/.claude/projects and writes backups to ~/.memory-audit/backups", () => {
    delete process.env.MEMORY_AUDIT_CLAUDE_DIR;
    delete process.env.MEMORY_AUDIT_BACKUP_DIR;
    process.env.HOME = sb.base;
    expect(projectsRoot()).toBe(path.join(sb.base, ".claude", "projects"));
    expect(backupsRoot()).toBe(path.join(sb.base, ".memory-audit", "backups"));
  });

  it("child refuses a base that isn't normalised", () => {
    expect(() => child("/srv/base/", "x")).toThrow(BadRequestError);
  });
});

describe("session parsing", () => {
  it("prefers a custom title, then an AI title, then the first prompt, then the id", async () => {
    sb.writeSession("custom", [{ type: "ai-title", aiTitle: "AI" }, { type: "custom-title", customTitle: "Mine" }, { type: "custom-title", customTitle: 5 }]);
    sb.writeSession("ai", [{ type: "ai-title", aiTitle: "AI" }, { type: "ai-title" }]);
    sb.writeSession("prompt", [{ type: "assistant", message: { content: [{ type: "text", text: "first" }] } }, { type: "user", message: { content: "x".repeat(100) } }]);
    sb.writeSession("abcdefghijk", [{ type: "assistant", message: { content: [{ type: "text", text: "  " }] } }]);
    expect((await readSession(PROJECT, "custom")).title).toBe("Mine");
    expect((await readSession(PROJECT, "ai")).title).toBe("AI");
    expect((await readSession(PROJECT, "prompt")).title).toBe("x".repeat(80));
    expect((await readSession(PROJECT, "abcdefghijk")).title).toBe("abcdefgh");
    expect((await getProject(PROJECT)).sessions.find((s) => s.id === "abcdefghijk")?.title).toBe("abcdefgh");
  });

  it("summarises tool calls by their most useful field", async () => {
    const use = (name: string | undefined, input?: object) => ({ type: "tool_use", ...(name && { name }), ...(input && { input }) });
    sb.writeSession("t", [
      {
        type: "assistant",
        message: {
          content: [
            use("Bash", { description: "List", command: "ls" }),
            use("Read", { file_path: "/a" }),
            use("Skill", { skill: "s" }),
            use("Fetch", { url: "u" }),
            use("Search", { query: "q" }),
            use("Grep", { pattern: "p" }),
            use("Agent", { prompt: "do it" }),
            use("Agent", { prompt: 1 }),
            use(undefined, undefined),
          ],
        },
      },
    ]);
    const s = await readSession(PROJECT, "t");
    expect(s.events.map((e) => `${e.tool}:${e.text}`)).toEqual(["Bash:List\nls", "Read:/a", "Skill:s", "Fetch:u", "Search:q", "Grep:p", "Agent:do it", 'Agent:{"prompt":1}', "tool:{}"]);
  });

  it("handles tool results, meta lines, odd content and long text", async () => {
    sb.writeSession("r", [
      { type: "user", message: { content: [{ type: "tool_result", content: [{ type: "text", text: "a" }, { type: "image" }, null], is_error: true }] } },
      { type: "user", message: { content: [{ type: "tool_result", content: { weird: 1 } }] } },
      { type: "user", message: { content: [{ type: "tool_result", content: "plain" }, { type: "text", text: "y".repeat(5000) }] } },
      { type: "user", message: { content: 42 } },
      { type: "user", message: { content: [{ type: "text", text: "<system-reminder>only context</system-reminder>" }, { type: "image" }] } },
      { type: "user", isMeta: true, message: { content: "line one\nline two" } },
      { type: "user", isMeta: true, message: { content: [] } },
      { type: "user", isSidechain: true, message: { content: "side" } },
      { type: "summary", summary: "s" },
      { type: "assistant", message: { content: "not an array" } },
    ]);
    const s = await readSession(PROJECT, "r");
    expect(s.events.map((e) => e.kind)).toEqual(["tool_result", "tool_result", "user", "tool_result", "context"]);
    expect(s.events[0]).toMatchObject({ text: "a\n[non-text content]\n[non-text content]", isError: true });
    expect(s.events[1].text).toBe("");
    expect(s.events[2]).toMatchObject({ truncated: true });
    expect(s.events[2].text).toHaveLength(4000);
    expect(s.events[4].text).toBe("line one");
    expect(s.skippedLines).toBe(6); // empty meta, number content, injected-only text, sidechain, summary, non-array assistant
  });

  it("skips session files whose names aren't valid ids", async () => {
    sb.writeSession("ok", [{ type: "user", message: { content: "hi" } }]);
    sb.writeSession("bad.name", [{ type: "user", message: { content: "hi" } }]);
    expect((await readAllSessions(PROJECT)).map((s) => s.id)).toEqual(["ok"]);
  });
});

describe("project listing", () => {
  it("sorts by last update with empty projects last, and names a root-folder project by its id", async () => {
    mkdirSync(path.join(sb.projects, "empty-one"));
    mkdirSync(path.join(sb.projects, "empty-two"));
    sb.writeSession("s", [{ type: "user", cwd: "/", message: { content: "hi" } }]);
    sb.writeSession("t", [{ type: "user", cwd: "/elsewhere", message: { content: "hi" } }]);
    const list = await listProjects();
    expect(list[0]).toMatchObject({ id: PROJECT, name: PROJECT, path: "/" });
    expect(list.slice(1).map((p) => p.updatedAt)).toEqual([null, null]);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("still lists a project whose log can't be read", async () => {
    const p = sb.writeSession("locked", [{ type: "user", cwd: "/x", message: { content: "hi" } }]);
    chmodSync(p, 0o000);
    try {
      expect((await listProjects())[0]).toMatchObject({ id: PROJECT, path: "/Users/dev/demo" });
    } finally {
      chmodSync(p, 0o600);
    }
  });
});

describe("ordering with missing timestamps", () => {
  it("sorts undated sessions and excerpts without crashing", async () => {
    sb.writeNote("db.md", note("Postgres database", "postgres storage", "x"));
    sb.writeSession("u1", [{ type: "user", message: { content: "postgres storage one" } }, { type: "user", message: { content: "postgres storage two" } }]);
    sb.writeSession("u2", [{ type: "user", message: { content: "postgres storage three" } }]);
    const c = await buildContext(PROJECT, "db.md");
    expect(c.excerpts).toHaveLength(3);
    expect(c.user).toMatch(/\(unknown start to \?\)/);
    expect((await auditProject(PROJECT)).sessionsRead).toBe(2);
  });
});

describe("writer edge cases", () => {
  it("creates a new note when none exists and nothing was expected", async () => {
    const r = await writeNote(PROJECT, "new.md", "hello", null, "t");
    expect(r.backup).toBeNull();
  });

  it("lists no backups for a note never changed, and 404s an unknown backup", async () => {
    expect(await listBackups(PROJECT, "x.md")).toEqual([]);
    await expect(readBackup(PROJECT, "x.md", "nope")).rejects.toThrow(NotFoundError);
  });

  it("restores a backup of a note that has since been deleted", async () => {
    const orig = note("A", "d", "v1");
    sb.writeNote("a.md", orig);
    const { backup } = await writeNote(PROJECT, "a.md", "v2", sha(orig), "t");
    rmSync(path.join(sb.memDir, "a.md"));
    const r = await restoreBackup(PROJECT, "a.md", backup!.id);
    expect(r.backup).toBeNull();
  });

  it("adds to the index: creating MEMORY.md, falling back to the file name, skipping missing notes", async () => {
    sb.writeNote("plain.md", "no header\n");
    await addToIndex(PROJECT, "plain.md");
    expect(readFileSync(path.join(sb.memDir, "MEMORY.md"), "utf8")).toBe("- [plain](plain.md)\n");
    await expect(addToIndex(PROJECT, "missing.md")).rejects.toThrow(NotFoundError);
  });

  it("removing broken links is a no-op without an index or without broken links", async () => {
    expect(await removeBrokenLinks(PROJECT)).toEqual({ backup: null, removed: [] });
    sb.writeNote("a.md", "x");
    sb.writeNote("MEMORY.md", "- [A](a.md)\n");
    expect(await removeBrokenLinks(PROJECT)).toEqual({ backup: null, removed: [] });
  });
});

describe("diff edge cases", () => {
  it("handles additions mid-file and trailing deletions", () => {
    expect(diffLines("a\nc", "a\nb\nc").map((l) => l.kind)).toEqual(["same", "add", "same"]);
    expect(diffLines("a\nb\nc", "a").map((l) => l.kind)).toEqual(["same", "del", "del"]);
  });

  it("marks a note without frontmatter as unverified", () => {
    expect(markUnverified("body", "Why.")).toMatch(/^> \*\*Unverified\*\* \(flagged \d{4}-\d{2}-\d{2}\): Why\. Check before relying on this\.\n\nbody$/);
  });
});

describe("guards without a Host header", () => {
  it("proxy and guardedJson refuse a request with no Host", async () => {
    const r = new NextRequest("http://127.0.0.1:3210/api/x");
    r.headers.delete("host");
    expect(proxy(r).status).toBe(403);
    const plain = new Request("http://127.0.0.1:3210/api/x", { method: "POST", body: "{}" });
    await expect(guardedJson(plain)).rejects.toThrow(ForbiddenError);
  });
});
