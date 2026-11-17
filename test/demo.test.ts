import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => {} }));

import { NextRequest } from "next/server";
import { connection, estimate, lastResult, verify } from "@/lib/audit/ai";
import { auditProject } from "@/lib/audit/checks";
import { buildContext, toResult } from "@/lib/audit/evidence";
import { addToIndex, removeBrokenLinks, writeNote } from "@/lib/audit/writer";
import { listProjects, readMemory } from "@/lib/claude-code/reader";
import { guardedJson } from "@/lib/claude-code/respond";
import { DEMO_READONLY, demoAnswer } from "@/lib/demo";
import { proxy } from "@/proxy";

const PROJECT = "-Users-dev-acme-storefront";
const NOTES = ["code-style.md", "db-conventions.md", "deploy-process.md", "release-checklist.md", "testing-preferences.md"];
const PUBLIC = "memory-audit-demo.vercel.app";

describe("hosted demo (MEMORY_AUDIT_DEMO=1)", () => {
  const before = { ...process.env };
  beforeEach(() => {
    process.env.MEMORY_AUDIT_DEMO = "1";
    // A real ~/.claude must never leak into the demo, whatever these point at.
    process.env.MEMORY_AUDIT_CLAUDE_DIR = "/nonexistent";
  });
  afterEach(() => {
    process.env = { ...before };
  });

  it("reads the bundled made-up project, not the home folder", async () => {
    const projects = await listProjects();
    expect(projects.map((p) => p.id)).toEqual([PROJECT]);
    // Dated by the logs, not by file times (Vercel resets those on deploy).
    expect(projects[0]).toMatchObject({ name: "acme-storefront", memoryCount: 5, sessionCount: 3 });
    expect(projects[0].updatedAt).toMatch(/^2026-10-28T/);
  });

  it("gives the quick checks something to find", async () => {
    const audit = await auditProject(PROJECT);
    const codes = (file: string) => audit.notes.find((n) => n.file === file)!.findings.map((f) => f.code);
    expect(audit.project.map((f) => f.code)).toContain("broken-links");
    expect(codes("deploy-process.md")).toContain("possible-correction");
    expect(codes("code-style.md")).toEqual(expect.arrayContaining(["not-indexed", "possible-correction"]));
    expect(codes("db-conventions.md")).toContain("origin-deleted");
    expect(codes("release-checklist.md")).toContain("missing-paths");
    expect(audit.notes.find((n) => n.file === "testing-preferences.md")!.status).toBe("ok");
  });

  it("has a saved AI answer for every note, and every citation points at a real log line", async () => {
    for (const file of NOTES) {
      const out = (await demoAnswer(file))!;
      expect(out, file).not.toBeNull();
      const r = toResult(await buildContext(PROJECT, file), file, out, {
        provider: "claude-code",
        model: "m",
        inputTokens: 0,
        outputTokens: 0,
        costUsd: null,
      });
      expect(r.droppedCitations, file).toBe(0);
      expect(r.verdict, file).toBe(out.verdict);
    }
    expect(await demoAnswer("MEMORY.md")).toBeNull();
  });

  it("replays the saved answer instead of calling a model, and offers a fix only where one is needed", async () => {
    expect(await connection()).toMatchObject({ connected: true, provider: "claude-code" });
    expect((await estimate(PROJECT, "deploy-process.md")).apiKeyFound).toBe(true);
    const r = await verify(PROJECT, "deploy-process.md"); // waits the demo's 1.5s pause
    expect(r.verdict).toBe("outdated");
    expect(r.proposedRaw).toContain("fly deploy");
    expect(r.reasons[0].evidence.length).toBeGreaterThan(0);
    expect(await lastResult(PROJECT, "deploy-process.md")).toBeNull();
  });

  it("refuses every write", async () => {
    const { sha } = (await readMemory(PROJECT, "code-style.md")) as { sha: string };
    await expect(writeNote(PROJECT, "code-style.md", "x", sha, "t")).rejects.toThrow(DEMO_READONLY);
    await expect(addToIndex(PROJECT, "code-style.md")).rejects.toThrow(DEMO_READONLY);
    await expect(removeBrokenLinks(PROJECT)).rejects.toThrow(DEMO_READONLY);
  });

  it("can be reached on a public host name, but still only from its own page", async () => {
    const req = (origin: string) =>
      new Request(`https://${PUBLIC}/api/x`, {
        method: "POST",
        headers: { host: PUBLIC, origin, "x-memory-audit": "1" },
        body: "{}",
      });
    await expect(guardedJson(req(`https://${PUBLIC}`))).resolves.toEqual({});
    await expect(guardedJson(req("https://evil.example"))).rejects.toThrow("Cross-site");
    expect(proxy(new NextRequest(`https://${PUBLIC}/api/x`, { headers: { host: PUBLIC } })).status).toBe(200);
  });

  it("keeps the localhost-only rule when demo mode is off", async () => {
    delete process.env.MEMORY_AUDIT_DEMO;
    expect(proxy(new NextRequest(`https://${PUBLIC}/api/x`, { headers: { host: PUBLIC } })).status).toBe(403);
  });
});
