import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditProject, mentionedPaths, ownWords, snippet, worst } from "@/lib/audit/checks";
import { diffLines, markUnverified } from "@/lib/diff";
import { PROJECT, note, sandbox, type Sandbox } from "./fixtures";

describe("pure helpers", () => {
  it("worst picks the most severe finding", () => {
    expect(worst([])).toBe("ok");
    expect(worst([{ severity: "info" }, { severity: "bad" }, { severity: "warn" }])).toBe("bad");
  });

  it("ownWords drops pasted content and code blocks", () => {
    expect(ownWords("keep <pasted_content id=1>drop</pasted_content> ```x``` this").replace(/\s+/g, " ")).toBe("keep this");
    expect(ownWords("This session is being continued from a previous conversation...")).toBe("");
  });

  it("snippet centres on the search term and marks truncation", () => {
    const s = snippet(`${"a ".repeat(200)}needle ${"b ".repeat(200)}`, "needle", 60);
    expect(s).toContain("needle");
    expect(s.startsWith("…") && s.endsWith("…")).toBe(true);
  });

  it("mentionedPaths finds absolute and backticked relative paths, not URLs or branches", () => {
    const paths = mentionedPaths("See /Users/dev/app/a.ts and `lib/x.ts`, not `feat/x` or https://x.io/a.ts.");
    expect(paths).toEqual(["/Users/dev/app/a.ts", "lib/x.ts"]);
  });

  it("diffLines produces a minimal line diff", () => {
    expect(diffLines("a\nb\nc", "a\nc\nd")).toEqual([
      { kind: "same", text: "a" },
      { kind: "del", text: "b" },
      { kind: "same", text: "c" },
      { kind: "add", text: "d" },
    ]);
  });

  it("markUnverified adds a banner and a frontmatter flag, idempotently", () => {
    const once = markUnverified(note("A", "d", "body"), "Stale.");
    const twice = markUnverified(once, "Stale.");
    expect(once).toMatch(/verified: false/);
    expect(once).toMatch(/> \*\*Unverified\*\*/);
    expect(twice.match(/Unverified/g)).toHaveLength(1);
    expect(twice.match(/verified: false/g)).toHaveLength(1);
  });
});

describe("auditProject", () => {
  let sb: Sandbox;
  beforeEach(() => (sb = sandbox()));
  afterEach(() => sb.cleanup());

  it("reports a missing index and no session logs", async () => {
    sb.writeNote("alpha.md", note("Alpha", "first", "body"));
    const a = await auditProject(PROJECT);
    expect(a.project.map((f) => f.code).sort()).toEqual(["no-index", "no-sessions"]);
    expect(a.notes).toHaveLength(1);
  });

  it("reports broken index links with a fix", async () => {
    sb.writeNote("MEMORY.md", "- [Alpha](alpha.md)\n- [Gone](gone.md)\n");
    sb.writeNote("alpha.md", note("Alpha", "first", "body"));
    const a = await auditProject(PROJECT);
    const broken = a.project.find((f) => f.code === "broken-links");
    expect(broken?.fix).toBe("remove-broken-links");
    expect(broken?.detail).toBe("gone.md");
  });
});
