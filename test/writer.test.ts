import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ConflictError,
  addToIndex,
  listBackups,
  readBackup,
  removeBrokenLinks,
  restoreBackup,
  sha,
  writeNote,
} from "@/lib/audit/writer";
import { BadRequestError, NotFoundError } from "@/lib/claude-code/reader";
import { PROJECT, note, sandbox, type Sandbox } from "./fixtures";

describe("writer", () => {
  let sb: Sandbox;
  const original = note("Alpha", "first", "v1");
  beforeEach(() => {
    sb = sandbox();
    sb.writeNote("alpha.md", original);
  });
  afterEach(() => sb.cleanup());

  const read = (f: string) => readFileSync(path.join(sb.memDir, f), "utf8");

  it("writes when the hash matches, backing up the old version", async () => {
    const r = await writeNote(PROJECT, "alpha.md", "v2", sha(original), "test");
    expect(read("alpha.md")).toBe("v2");
    expect(r.sha).toBe(sha("v2"));
    expect(r.backup).not.toBeNull();
    expect(r.backup!.file).toBe("alpha.md");
    expect(await readBackup(PROJECT, "alpha.md", r.backup!.id)).toBe(original);
    expect(sb.backups.startsWith(sb.base)).toBe(true);
  });

  it("refuses to overwrite a note that changed since it was read", async () => {
    await expect(writeNote(PROJECT, "alpha.md", "v2", sha("something else"), "test")).rejects.toThrow(ConflictError);
    expect(read("alpha.md")).toBe(original);
  });

  it("refuses writes in read-only mode", async () => {
    process.env.MEMORY_AUDIT_READONLY = "1";
    await expect(writeNote(PROJECT, "alpha.md", "v2", sha(original), "test")).rejects.toThrow(/turned off/);
    expect(read("alpha.md")).toBe(original);
  });

  it("refuses oversized notes", async () => {
    await expect(writeNote(PROJECT, "alpha.md", "x".repeat(200_001), sha(original), "t")).rejects.toThrow(BadRequestError);
  });

  it.each(["../alpha.md", "../../evil.md", "a/b.md", "alpha.txt", "alpha.md/../x.md"])("refuses unsafe file name %j", async (f) => {
    await expect(writeNote(PROJECT, f, "x", null, "t")).rejects.toThrow(BadRequestError);
  });

  it("refuses unsafe project ids", async () => {
    await expect(writeNote("..", "alpha.md", "x", sha(original), "t")).rejects.toThrow(BadRequestError);
  });

  it("refuses to create a note when a hash was expected", async () => {
    await expect(writeNote(PROJECT, "new.md", "x", "abc", "t")).rejects.toThrow(NotFoundError);
  });

  it("rejects malformed backup ids", async () => {
    await expect(readBackup(PROJECT, "alpha.md", "../../etc/passwd")).rejects.toThrow(BadRequestError);
  });

  it("restores a backup, and the restore itself can be undone", async () => {
    const { backup } = await writeNote(PROJECT, "alpha.md", "v2", sha(original), "edit");
    await restoreBackup(PROJECT, "alpha.md", backup!.id);
    expect(read("alpha.md")).toBe(original);
    const all = await listBackups(PROJECT, "alpha.md");
    expect(all).toHaveLength(2);
  });

  it("adds a note to MEMORY.md once", async () => {
    sb.writeNote("MEMORY.md", "- [Other](other.md)\n");
    await addToIndex(PROJECT, "alpha.md");
    await addToIndex(PROJECT, "alpha.md");
    const index = read("MEMORY.md");
    expect(index).toBe("- [Other](other.md)\n- [Alpha](alpha.md) — first\n");
  });

  it("removes only index lines whose links are all broken", async () => {
    sb.writeNote("MEMORY.md", "# Index\n- [Alpha](alpha.md)\n- [Gone](gone.md)\n");
    const r = await removeBrokenLinks(PROJECT);
    expect(r.removed).toEqual(["- [Gone](gone.md)"]);
    expect(read("MEMORY.md")).toBe("# Index\n- [Alpha](alpha.md)\n");
  });
});
