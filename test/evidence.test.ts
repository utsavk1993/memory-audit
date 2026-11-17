import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildContext, lastResult, saveResult, toResult, type Out } from "@/lib/audit/evidence";
import { hasRealFix } from "@/lib/audit/fixable";
import { PROJECT, note, sandbox, type Sandbox } from "./fixtures";

const NOTE = note("Postgres database", "postgres storage", "We use Postgres.");
const meta = { provider: "anthropic" as const, model: "m", inputTokens: 1, outputTokens: 2, costUsd: 0.1 };
const at = (d: number) => `2026-01-${String(d).padStart(2, "0")}T00:00:00Z`;
const user = (d: number | null, text: string) => ({ type: "user", ...(d && { timestamp: at(d) }), message: { content: text } });
const tool = (d: number, name: string, input: object) => ({
  type: "assistant",
  timestamp: at(d),
  message: { content: [{ type: "tool_use", name, input }] },
});

let sb: Sandbox;
beforeEach(() => {
  sb = sandbox();
  sb.writeNote("db.md", NOTE);
});
afterEach(() => sb.cleanup());

describe("buildContext", () => {
  it("says so when there are no logs or excerpts", async () => {
    const c = await buildContext(PROJECT, "db.md");
    expect(c.user).toContain("(no session logs on disk)");
    expect(c.user).toContain("(no related excerpts found)");
    expect(c.user).toContain(`<note file="db.md" last_modified="${c.note.updatedAt}">`);
  });

  it("includes the conversation around the write and topic matches, in time order", async () => {
    sb.writeSession("a", [
      user(2, "let's use postgres for the database storage"),
      { type: "user", isMeta: true, timestamp: at(2), message: { content: "meta context" } },
      tool(2, "Bash", { command: "ls" }),
      { type: "user", timestamp: at(2), message: { content: [{ type: "tool_result", content: "out" }] } },
      tool(3, "Write", { file_path: "/p/memory/db.md" }),
      user(3, "postgres is great"), // one key word only: not a topic match on its own
    ]);
    sb.writeSession("b", [user(9, "x".repeat(2000) + " postgres storage")]);
    sb.writeSession("c", [user(null, "unrelated")]);
    const c = await buildContext(PROJECT, "db.md");
    expect(c.excerpts.map((x) => `${x.tag}:${x.event.kind}`)).toEqual(["S2:user", "S2:memory_write", "S2:user", "S3:user"]);
    expect(c.user).toContain('from="memory write">\nWrite db.md');
    expect(c.user).toContain(" […]"); // the 2000-character message is clipped
    expect(c.user).toContain(`S2: “let's use postgres for the database storage” (${at(2)} to ${at(3)})`);
    expect(c.user).not.toContain("S1:"); // the unrelated session isn't listed
  });

  it("uses the note's own modified date when it has one", async () => {
    sb.writeNote("db.md", `---\nname: Postgres\nmodified: 2025-05-05\n---\nx\n`);
    expect((await buildContext(PROJECT, "db.md")).user).toContain('last_modified="2025-05-05"');
  });

  it("stops adding topic matches once the context budget is spent, keeping the strongest", async () => {
    const lines = Array.from({ length: 150 }, (_, i) => user((i % 28) + 1, `${"y".repeat(1600)} postgres storage database`));
    lines.push(user(1, "postgres"));
    sb.writeSession("big", lines);
    const c = await buildContext(PROJECT, "db.md");
    expect(c.excerpts.length).toBeLessThan(150);
    expect(c.excerpts.length).toBeGreaterThan(90);
  });

  it("ties on score go to the newest message", async () => {
    sb.writeSession("s", [user(1, "postgres storage old"), user(5, "postgres storage new"), user(null, "postgres storage undated")]);
    const c = await buildContext(PROJECT, "db.md");
    expect(c.excerpts.map((x) => x.event.text)).toEqual(["postgres storage undated", "postgres storage old", "postgres storage new"]);
  });

  it("a note with a single keyword matches on that keyword alone", async () => {
    sb.writeNote("db.md", `---\nname: Postgres\n---\nx\n`);
    sb.writeSession("s", [user(1, "postgres!"), user(2, "nothing")]);
    expect((await buildContext(PROJECT, "db.md")).excerpts).toHaveLength(1);
  });
});

describe("toResult", () => {
  const out = (o: Partial<Out> = {}): Out => ({
    verdict: "outdated",
    confidence: "high",
    summary: "s",
    claims: [
      {
        claim: "c",
        status: "outdated",
        explanation: "e",
        evidence: [
          { session: "S1", line: 1 }, // real
          { session: "S1", line: 2 }, // a context line: not citable
          { session: "S1", line: 99 }, // no such line
          { session: "S9", line: 1 }, // no such session
        ],
      },
    ],
    proposed_note: "fixed",
    ...o,
  });

  const ctx = async () => {
    sb.writeSession("s", [user(1, "postgres storage"), { type: "user", isMeta: true, message: { content: "ctx" } }]);
    return buildContext(PROJECT, "db.md");
  };

  it("keeps real citations, drops invented ones, and keeps a fix that changes something", async () => {
    const r = toResult(await ctx(), "db.md", out(), meta);
    expect(r.reasons[0].evidence.map((e) => e.line)).toEqual([1]);
    expect(r.droppedCitations).toBe(3);
    expect(r.proposedRaw).toBe("fixed\n");
    expect(r.usage).toEqual({ inputTokens: 1, outputTokens: 2, costUsd: 0.1 });
  });

  it("drops a proposed fix that is empty, unchanged, or only marks claims unverified", async () => {
    const c = await ctx();
    expect(toResult(c, "db.md", out({ proposed_note: "  " }), meta).proposedRaw).toBeNull();
    expect(toResult(c, "db.md", out({ proposed_note: NOTE }), meta).proposedRaw).toBeNull();
    const unverified = out({ claims: [{ claim: "c", status: "unverified", explanation: "e", evidence: [] }] });
    expect(toResult(c, "db.md", unverified, meta).proposedRaw).toBeNull();
  });

  it("treats a claim with no real citation as unverified and recomputes the verdict", async () => {
    const c = await ctx();
    const claim = (status: "supported" | "outdated" | "contradicted" | "unverified", evidence: { session: string; line: number }[]) => ({ claim: status, status, explanation: "e", evidence });
    // The only "contradicted" claim cites an invented line, so the verdict falls to the next most serious claim.
    const r = toResult(c, "db.md", out({ verdict: "contradicted", claims: [
      claim("contradicted", [{ session: "S9", line: 1 }]),
      claim("supported", []),
      claim("supported", [{ session: "S1", line: 1 }]),
    ] }), meta);
    expect(r.reasons.map((x) => x.status)).toEqual(["unverified", "unverified", "supported"]);
    expect(r.reasons[0].explanation).toBe("e (No real log line backs this, so it counts as unverified.)");
    expect(r.downgradedClaims).toBe(2);
    expect(r.verdict).toBe("unverified");
    expect(r.confidence).toBe("low");
    expect(r.summary).toBe("2 claims cite no real log line, so they count as unverified. The AI's summary: s");
    const one = toResult(c, "db.md", out({ claims: [claim("supported", [])] }), meta);
    expect(one.summary).toBe("1 claim cites no real log line, so it counts as unverified. The AI's summary: s");
    expect(r.proposedRaw).toBeNull(); // nothing backed is out of date or wrong any more

    // Real citations: the model's statuses and verdict stand.
    const kept = toResult(c, "db.md", out({ verdict: "outdated", claims: [claim("outdated", [{ session: "S1", line: 1 }]), claim("unverified", [])] }), meta);
    expect(kept.downgradedClaims).toBe(0);
    expect(kept.verdict).toBe("outdated");
    expect(kept.confidence).toBe("high");
    expect(kept.summary).toBe("s");
    expect(kept.reasons[1].explanation).toBe("e");

    // The verdict follows the claims even when the model's own verdict disagrees with them.
    const green = toResult(c, "db.md", out({ verdict: "supported", claims: [claim("contradicted", [{ session: "S1", line: 1 }])] }), meta);
    expect(green.verdict).toBe("contradicted");
  });

  it("hasRealFix only for outdated or contradicted claims", () => {
    expect(hasRealFix([{ status: "supported" }, { status: "unverified" }])).toBe(false);
    expect(hasRealFix([{ status: "contradicted" }])).toBe(true);
  });
});

describe("results cache", () => {
  it("round-trips a result and returns null when there is none", async () => {
    expect(await lastResult(PROJECT, "db.md")).toBeNull();
    const r = toResult(await buildContext(PROJECT, "db.md"), "db.md", { verdict: "supported", confidence: "low", summary: "", claims: [], proposed_note: "" }, meta);
    await saveResult(PROJECT, r);
    expect(await lastResult(PROJECT, "db.md")).toEqual(JSON.parse(JSON.stringify(r)));
  });

  it("defaults to ~/.memory-audit/results", async () => {
    delete process.env.MEMORY_AUDIT_DATA_DIR;
    process.env.HOME = sb.base;
    expect(await lastResult(PROJECT, "db.md")).toBeNull();
  });
});
