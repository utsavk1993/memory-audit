// Scenario tests for the free per-note checks in lib/audit/checks.ts.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditProject, keywords, mentionedPaths, snippet, toEvidence } from "@/lib/audit/checks";
import type { SessionDetail, SessionEvent } from "@/lib/claude-code/types";
import { PROJECT, note, sandbox, type Sandbox } from "./fixtures";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const user = (at: string | null, text: string, cwd?: string) => ({ type: "user", ...(at && { timestamp: at }), cwd, message: { content: text } });
const write = (at: string, file: string) => ({
  type: "assistant",
  timestamp: at,
  message: { content: [{ type: "tool_use", name: "Write", input: { file_path: `/p/memory/${file}` } }] },
});

let sb: Sandbox;
let repo: string;
beforeEach(() => {
  sb = sandbox();
  repo = path.join(sb.base, "repo");
  mkdirSync(path.join(repo, "src"), { recursive: true });
  mkdirSync(path.join(repo, "node_modules"), { recursive: true });
  writeFileSync(path.join(repo, "README.md"), "");
  writeFileSync(path.join(repo, "src", "app.ts"), "");
});
afterEach(() => sb.cleanup());

const codes = async (file: string) => {
  const a = await auditProject(PROJECT);
  const n = a.notes.find((x) => x.file === file)!;
  return Object.fromEntries(n.findings.map((f) => [f.code, f]));
};

describe("per-note checks", () => {
  it("flags notes missing from the index, with provenance from one logged write", async () => {
    sb.writeNote("MEMORY.md", "");
    sb.writeNote("alpha.md", note("Alpha", "first", "body"));
    sb.writeSession("s1", [user(daysAgo(1), "hi", repo), write(daysAgo(1), "alpha.md")]);
    const f = await codes("alpha.md");
    expect(f["not-indexed"].fix).toBe("add-to-index");
    expect(f.provenance.title).toBe("Written in 1 logged session");
  });

  it("names the origin session, and counts several writes", async () => {
    sb.writeNote("a.md", `---\nname: A\ndescription: d\ntype: t\noriginSessionId: s1\n---\nbody\n`);
    sb.writeNote("b.md", note("B", "d", "body"));
    sb.writeSession("s1", [user(daysAgo(2), "Set up", repo), write(daysAgo(2), "b.md"), { type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "/p/memory/b.md" } }] } }, write(daysAgo(1), "b.md")]);
    expect((await codes("a.md")).provenance.title).toBe("Written in “Set up”");
    expect((await codes("b.md")).provenance.title).toBe("Written in 3 logged sessions");
  });

  it("warns when the origin session was deleted", async () => {
    sb.writeNote("a.md", `---\nname: A\ndescription: d\ntype: t\noriginSessionId: gone\n---\nbody\n`);
    expect((await codes("a.md"))["origin-deleted"].severity).toBe("warn");
  });

  it("reports missing provenance as a warning with logs, info without", async () => {
    sb.writeNote("a.md", note("A", "d", "body"));
    expect((await codes("a.md"))["no-provenance"].severity).toBe("info");
    sb.writeSession("s1", [user(daysAgo(1), "hi")]);
    expect((await codes("a.md"))["no-provenance"].severity).toBe("warn");
  });

  it("flags old notes in active projects: info after 30 days, warning after 90", async () => {
    sb.writeNote("a.md", `---\nname: A\ndescription: d\ntype: t\nmodified: ${daysAgo(40)}\n---\nbody\n`);
    sb.writeNote("b.md", `---\nname: B\ndescription: d\ntype: t\nmodified: ${daysAgo(100)}\n---\nbody\n`);
    sb.writeNote("c.md", `---\nname: C\ndescription: d\ntype: t\nmodified: not a date\n---\nbody\n`);
    sb.writeSession("s1", [user(daysAgo(5), "hi")]);
    sb.writeSession("s2", [user(daysAgo(50), "hi")]);
    sb.writeSession("s3", [{ type: "user", message: { content: "no time" } }]);
    const a = await codes("a.md");
    expect(a.old.severity).toBe("info");
    expect(a.old.title).toMatch(/1 newer conversation happened$/);
    const b = await codes("b.md");
    expect(b.old.severity).toBe("warn");
    expect(b.old.title).toMatch(/2 newer conversations happened$/);
    expect((await codes("c.md")).old).toBeUndefined();
  });

  it("uses the newest logged write as the note's date", async () => {
    sb.writeNote("a.md", note("A", "d", "body"));
    sb.writeSession("s1", [user(daysAgo(60), "hi"), write(daysAgo(60), "a.md"), write(daysAgo(40), "a.md")]);
    sb.writeSession("s2", [user(daysAgo(10), "hi")]);
    expect((await codes("a.md")).old.title).toMatch(/^Not updated in 40 days/);
  });

  it("lists paths that no longer exist, searching the project and one level down", async () => {
    sb.writeNote("one.md", note("One", "d", "See `README.md`, `app.ts`... no: `src/app.ts` and `gone/x.ts`, ~/definitely-missing-xyz and /etc."));
    sb.writeNote("two.md", note("Two", "d", "`a/one.ts` `b/two.ts`"));
    sb.writeNote("ok.md", note("Ok", "d", `Lives in ${repo}/README.md and \`src/app.ts\`.`));
    sb.writeSession("s1", [user(daysAgo(1), "hi", repo)]);
    const one = await codes("one.md");
    expect(one["missing-paths"].detail).toBe("~/definitely-missing-xyz\ngone/x.ts");
    expect(one["missing-paths"].title).toBe("Mentions 2 paths that no longer exist");
    expect((await codes("ok.md"))["missing-paths"]).toBeUndefined();
    sb.writeNote("one.md", note("One", "d", "`gone/x.ts`"));
    expect((await codes("one.md"))["missing-paths"].title).toBe("Mentions 1 path that no longer exists");
  });

  it("skips relative paths when the project folder is gone, and copes with a file in its place", async () => {
    sb.writeNote("a.md", note("A", "d", "`gone/x.ts` and /opt/nope-abs-path-xyz"));
    sb.writeSession("s1", [user(daysAgo(1), "hi", path.join(sb.base, "no-such-dir"))]);
    expect((await codes("a.md"))["missing-paths"].detail).toBe("/opt/nope-abs-path-xyz");
    sb.writeSession("s1", [user(daysAgo(1), "hi", path.join(repo, "README.md"))]);
    expect((await codes("a.md"))["missing-paths"].detail).toBe("/opt/nope-abs-path-xyz\ngone/x.ts");
  });

  it("finds later corrections on the same topic in the user's own words", async () => {
    sb.writeNote("db.md", `---\nname: Postgres database\ndescription: we use postgres for storage\ntype: project\nmodified: ${daysAgo(20)}\n---\nWe use Postgres.\n`);
    sb.writeSession("s1", [
      user(daysAgo(30), "The postgres database is wrong."), // before the note: ignored
      user(daysAgo(10), "Actually the postgres database is no longer used. We switched to SQLite."),
      user(null, "Scratch that, postgres storage is outdated."),
      user(daysAgo(5), "<pasted_content>postgres database is wrong</pasted_content> thanks"),
      user(daysAgo(5), "postgres database is great"),
      user(daysAgo(5), "That storage thing is wrong and outdated."),
      { type: "assistant", timestamp: daysAgo(5), message: { content: [{ type: "text", text: "postgres database is wrong" }] } },
    ]);
    const f = (await codes("db.md"))["possible-correction"];
    expect(f.title).toBe("You may have corrected this topic later (2 messages)");
    expect(f.evidence!.map((e) => e.quote)).toEqual(["Actually the postgres database is no longer used.", "Scratch that, postgres storage is outdated."]);

    sb.writeSession("s1", [user(daysAgo(10), "The postgres database is wrong.")]);
    expect((await codes("db.md"))["possible-correction"].title).toMatch(/\(1 message\)$/);
  });

  it("checks header fields, empty bodies and near-duplicates", async () => {
    sb.writeNote("bare.md", "\n");
    sb.writeNote("x.md", note("Deploy pipeline settings", "how the deploy pipeline settings work", "a"));
    sb.writeNote("y.md", note("Deploy pipeline settings copy", "how the deploy pipeline settings work today", "b"));
    sb.writeNote("z.md", `---\ndescription: how the deploy pipeline settings work today\n---\nc\n`);
    const bare = await codes("bare.md");
    expect(bare.frontmatter.title).toBe("Missing name, description, type in the header");
    expect(bare.empty.severity).toBe("warn");
    expect((await codes("x.md")).duplicate.title).toBe("Looks similar to Deploy pipeline settings copy, z.md");
    expect((await codes("z.md")).frontmatter.title).toBe("Missing name, type in the header");
  });
});

describe("project-level checks", () => {
  it("warns when MEMORY.md is longer than Claude loads, and counts broken links", async () => {
    sb.writeNote("MEMORY.md", `- [A](a.md)\n- [B](b.md)\n${"line\n".repeat(200)}`);
    const a = await auditProject(PROJECT);
    expect(a.project.find((f) => f.code === "index-too-long")?.title).toBe("MEMORY.md has 203 lines; only the first 200 are loaded");
    expect(a.project.find((f) => f.code === "broken-links")?.title).toBe("MEMORY.md points to 2 files that don't exist");
  });

  it("is quiet for an empty memory folder and sorts notes by severity then name", async () => {
    expect((await auditProject(PROJECT)).project).toEqual([]);
    sb.writeNote("MEMORY.md", "- [B](b.md)\n- [A](a.md)\n- [C](c.md)\n");
    sb.writeNote("a.md", note("A", "d", "x"));
    sb.writeNote("b.md", note("B", "d", "x"));
    sb.writeNote("c.md", note("C", "d", ""));
    sb.writeSession("s1", [user(daysAgo(1), "hi"), write(daysAgo(1), "a.md"), write(daysAgo(1), "b.md")]);
    const a = await auditProject(PROJECT);
    expect(a.notes.map((n) => n.file)).toEqual(["c.md", "a.md", "b.md"]);
    expect(a.counts).toEqual({ ok: 2, info: 0, warn: 1, bad: 0 });
  });
});

describe("helpers", () => {
  it("keywords puts name words first and caps at ten", () => {
    expect(keywords({ name: "Alpha beta", description: "gamma delta" }, "x.md")).toEqual(["alpha", "beta", "gamma", "delta"]);
    expect(keywords({}, "file-name-here.md")).toEqual(["file", "name"]); // "here" is a stopword
    expect(keywords({ description: Array.from({ length: 20 }, (_, i) => `word${"x".repeat(i)}`).join(" ") }, "a.md")).toHaveLength(10);
  });

  it("snippet handles short text, a missing term and the end of the text", () => {
    expect(snippet("  short   text ", "x")).toBe("short text");
    expect(snippet("a".repeat(300), null, 10)).toBe(`${"a".repeat(10)}…`);
    expect(snippet(`${"a ".repeat(100)}needle`, "needle", 30).endsWith("needle")).toBe(true);
  });

  it("mentionedPaths ignores globs, placeholders and trailing punctuation", () => {
    expect(mentionedPaths("~/a/*.ts /Users/<you>/x /opt/app/run.sh: `lib/a.ts`.")).toEqual(["/opt/app/run.sh", "lib/a.ts"]);
    expect(mentionedPaths(Array.from({ length: 30 }, (_, i) => `/etc/f${i}`).join(" "))).toHaveLength(20);
  });

  it("toEvidence labels who said it", () => {
    const s = { id: "s", title: "T" } as SessionDetail;
    const ev = (kind: SessionEvent["kind"], extra = {}) => toEvidence(s, { index: 1, kind, at: null, text: "t", ...extra } as SessionEvent).who;
    expect([ev("user"), ev("assistant"), ev("tool_use"), ev("memory_write", { memoryFile: "a.md" })]).toEqual(["user", "assistant", "tool", "memory_write"]);
    expect(toEvidence(s, { index: 1, kind: "memory_write", at: null, text: "", memoryFile: "a.md", tool: "Edit" } as SessionEvent).quote).toBe("Edit a.md");
    expect(toEvidence(s, { index: 1, kind: "memory_write", at: null, text: "", memoryFile: "a.md" } as SessionEvent).quote).toBe("Write a.md");
  });
});
