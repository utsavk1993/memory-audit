import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BadRequestError,
  NotFoundError,
  child,
  getProject,
  listProjects,
  parseFrontmatter,
  readMemory,
  readSession,
} from "@/lib/claude-code/reader";
import { PROJECT, note, sandbox, type Sandbox } from "./fixtures";

describe("child (path containment)", () => {
  const base = path.resolve("/srv/base");

  it("resolves a plain name inside the base", () => {
    expect(child(base, "note.md")).toBe(path.join(base, "note.md"));
  });

  it.each(["", ".", "..", "../etc", "a/b", "a\\b", "..\\x", "x\0y", "/etc/passwd"])("rejects %j", (name) => {
    expect(() => child(base, name)).toThrow(BadRequestError);
  });
});

describe("parseFrontmatter", () => {
  it("reads key/value pairs and returns the body", () => {
    const { frontmatter, body } = parseFrontmatter(note("My note", "A thing", "Body text"));
    expect(frontmatter).toMatchObject({ name: "My note", description: "A thing", type: "project" });
    expect(body.trim()).toBe("Body text");
  });

  it("unquotes single- and double-quoted values", () => {
    const { frontmatter } = parseFrontmatter(`---\na: "x \\"y\\""\nb: 'it''s'\n---\n`);
    expect(frontmatter).toEqual({ a: 'x "y"', b: "it's" });
  });

  it("treats text without frontmatter as all body", () => {
    expect(parseFrontmatter("just text")).toEqual({ frontmatter: {}, body: "just text" });
  });
});

describe("reading projects, notes and sessions", () => {
  let sb: Sandbox;
  beforeEach(() => {
    sb = sandbox();
    sb.writeNote("MEMORY.md", "- [Alpha](alpha.md) — first\n- [Gone](gone.md) — missing\n");
    sb.writeNote("alpha.md", note("Alpha", "first note", "Alpha body"));
    sb.writeNote("beta.md", note("Beta", "second note", "Beta body"));
    sb.writeSession("s1", [
      { type: "user", timestamp: "2026-01-01T00:00:00Z", cwd: "/Users/dev/demo", message: { content: "hello <system-reminder>hidden</system-reminder>" } },
      {
        type: "assistant",
        timestamp: "2026-01-01T00:00:05Z",
        message: {
          content: [
            { type: "text", text: "hi" },
            { type: "tool_use", name: "Write", input: { file_path: "/x/memory/alpha.md" } },
          ],
        },
      },
      "not json",
    ]);
  });
  afterEach(() => sb.cleanup());

  it("lists the project with its real cwd and counts", async () => {
    const [p] = await listProjects();
    expect(p).toMatchObject({ id: PROJECT, path: "/Users/dev/demo", name: "demo", memoryCount: 2, sessionCount: 1 });
  });

  it("flags index membership and broken index links", async () => {
    const p = await getProject(PROJECT);
    const byFile = Object.fromEntries(p.memory.map((m) => [m.file, m]));
    expect(byFile["alpha.md"].inIndex).toBe(true);
    expect(byFile["beta.md"].inIndex).toBe(false);
    expect(p.brokenIndexLinks).toEqual(["gone.md"]);
  });

  it("reads a note with a content hash", async () => {
    const m = await readMemory(PROJECT, "alpha.md");
    expect(m.frontmatter.name).toBe("Alpha");
    expect(m.sha).toMatch(/^[0-9a-f]{64}$/);
  });

  it("strips injected context from user turns and tags memory writes", async () => {
    const s = await readSession(PROJECT, "s1");
    const user = s.events.find((e) => e.kind === "user");
    expect(user?.text).toBe("hello");
    expect(s.events.find((e) => e.kind === "memory_write")?.memoryFile).toBe("alpha.md");
  });

  it("throws NotFound for missing things", async () => {
    await expect(getProject("nope")).rejects.toThrow(NotFoundError);
    await expect(readMemory(PROJECT, "nope.md")).rejects.toThrow(NotFoundError);
    await expect(readSession(PROJECT, "nope")).rejects.toThrow(NotFoundError);
  });

  it("refuses path traversal and non-.md files", async () => {
    await expect(readMemory("..", "alpha.md")).rejects.toThrow(BadRequestError);
    await expect(readMemory(PROJECT, "../s1.jsonl")).rejects.toThrow(BadRequestError);
    await expect(readMemory(PROJECT, "../../x.md")).rejects.toThrow(BadRequestError);
    await expect(readMemory(PROJECT, "notes.txt")).rejects.toThrow(BadRequestError);
    await expect(readSession(PROJECT, "../s1")).rejects.toThrow(BadRequestError);
    await expect(getProject("../projects")).rejects.toThrow(BadRequestError);
  });
});
