// The headless CLI (lib/cli/main.ts), run in-process: each call sets argv, re-imports the module and
// captures stdout, stderr and the exit code. `ui` has its process spawning and polling mocked.

import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha } from "@/lib/audit/writer";
import { PROJECT, note, sandbox, type Sandbox } from "./fixtures";

const h = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: h.spawn }));

let sb: Sandbox;
const ALPHA = note("Alpha", "first note", "Alpha body");

beforeEach(() => {
  sb = sandbox();
  process.env.HOME = sb.base;
  process.env.CLAUDE_PROJECT_DIR = "/Users/dev/demo";
  sb.writeNote("MEMORY.md", "- [Alpha](alpha.md)\n");
  sb.writeNote("alpha.md", ALPHA);
  sb.writeSession("s1", [
    { type: "user", timestamp: "2026-01-01T00:00:00Z", cwd: "/Users/dev/demo", message: { content: "remember alpha first note" } },
  ]);
  h.spawn.mockReset();
});
afterEach(() => {
  sb.cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function cli(args: string[], opts: { stdin?: string; timers?: (done: Promise<unknown>) => Promise<void> } = {}) {
  vi.resetModules();
  const argv = process.argv;
  process.argv = ["node", "memory-audit", ...args];
  let out = "";
  let err = "";
  let code: number | undefined;
  const spies: { mockRestore(): void }[] = [
    vi.spyOn(process.stdout, "write").mockImplementation((s) => ((out += String(s)), true)),
    vi.spyOn(process.stderr, "write").mockImplementation((s) => ((err += String(s)), true)),
    vi.spyOn(process, "exit").mockImplementation(((c?: number) => void (code = c)) as never),
  ];
  if (opts.stdin !== undefined) spies.push(vi.spyOn(process, "stdin", "get").mockReturnValue(Readable.from([Buffer.from(opts.stdin)]) as never));
  try {
    const { done } = await import("@/lib/cli/main");
    if (opts.timers) await opts.timers(done);
    await done;
  } finally {
    process.argv = argv;
    for (const s of spies) s.mockRestore();
  }
  return { out, err, code };
}

const readNote = (f: string) => readFileSync(path.join(sb.memDir, f), "utf8");

describe("help and usage errors", () => {
  it.each([[[]], [["help"]], [["check", "--help"]]])("prints help for %j", async (args) => {
    expect((await cli(args)).out).toMatch(/^memory-audit: check your Claude Code memory/);
  });

  it("rejects an unknown command with exit code 2", async () => {
    const r = await cli(["nope"]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/Unknown command "nope"/);
  });

  it("asks for a note name", async () => {
    expect((await cli(["evidence"])).err).toMatch(/Name the note/);
  });

  it("prints a stack trace and exits 1 for unexpected errors", async () => {
    const r = await cli(["apply", "alpha", path.join(sb.base, "missing-input.md"), "--sha", "x"]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/ENOENT[\s\S]*\n\s+at /);
  });
});

describe("finding the project", () => {
  it("from CLAUDE_PROJECT_DIR, the current folder or --project (id or path)", async () => {
    expect((await cli(["check"])).out).toContain(`project id ${PROJECT}`);
    expect((await cli(["check", "--project", PROJECT])).out).toContain("Memory Audit · /Users/dev/demo");
    expect((await cli(["check", "--project", "/Users/dev/demo/src/deep"])).out).toContain(`project id ${PROJECT}`);
  });

  it("by the folder recorded in a log when the id doesn't match the path", async () => {
    const repo = path.join(sb.base, "my.repo");
    mkdirSync(path.join(sb.projects, "custom-id"), { recursive: true });
    writeFileSync(path.join(sb.projects, "custom-id", "x.jsonl"), JSON.stringify({ type: "user", cwd: repo, message: { content: "hi" } }));
    expect((await cli(["check", "--project", repo])).out).toContain("project id custom-id");
  });

  it("explains how to pick one when nothing matches", async () => {
    delete process.env.CLAUDE_PROJECT_DIR;
    const r = await cli(["check"]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/No Claude Code project found for .*Pass --project <id>/);
    expect((await cli(["check", "--project"])).code).toBe(2); // flag without a value
    expect((await cli(["check", "--project", "--json"])).code).toBe(2);
  });

  it("says when it uses a parent folder's project", async () => {
    const r = await cli(["check", "--project", "/Users/dev/demo/src/deep"]);
    expect(r.err).toBe("memory-audit: using the project for /Users/dev/demo (there is none for /Users/dev/demo/src/deep).\n");
    expect((await cli(["check"])).err).toBe(""); // exact match: no note
  });

  it("never walks up to the home folder's project from a folder inside it", async () => {
    const home = path.join(sb.base, "home");
    mkdirSync(home);
    process.env.HOME = home;
    mkdirSync(path.join(sb.projects, home.replace(/[^A-Za-z0-9]/g, "-")), { recursive: true });
    const inside = await cli(["check", "--project", path.join(home, "new-folder")]);
    expect(inside.code).toBe(2);
    expect(inside.err).toMatch(/No Claude Code project found for/);
    expect((await cli(["check", "--project", home])).out).toContain(`Memory Audit · ${home}`); // the home folder itself is fine
    // macOS and Windows ignore case in paths, so a differently-cased path is still inside home there.
    const shouted = await cli(["check", "--project", path.join(home.toUpperCase(), "new-folder")]);
    if (process.platform === "darwin" || process.platform === "win32") expect(shouted.err).toMatch(/No Claude Code project found/);
    // A trailing slash on HOME doesn't defeat the guard either.
    process.env.HOME = `${home}/`;
    expect((await cli(["check", "--project", path.join(home, "new-folder")])).code).toBe(2);
  });

  it("reports the project's real folder name when a path in another letter case finds it (macOS, Windows)", async () => {
    const r = await cli(["check", "--json", "--project", "/USERS/DEV/DEMO"]);
    // Case-sensitive disks (Linux) have no such folder; elsewhere it is the same project, under its real id.
    if (r.code === undefined) expect(JSON.parse(r.out).projectId).toBe(PROJECT);
    else expect(r.err).toMatch(/No Claude Code project found/);
  });

  it("treats . and .. as paths, not project ids", async () => {
    const cwd = process.cwd();
    process.chdir(sb.base);
    try {
      for (const p of [".", ".."]) expect((await cli(["check", "--project", p])).err).toMatch(/No Claude Code project found for/);
    } finally {
      process.chdir(cwd);
    }
  });

  it("accepts --flag=value and rejects options the command doesn't take", async () => {
    expect((await cli(["check", `--project=${PROJECT}`])).out).toContain(`project id ${PROJECT}`);
    const typo = await cli(["check", "--jsno"]);
    expect(typo.code).toBe(2);
    expect(typo.err).toBe("memory-audit: check doesn't take --jsno. Its options: --project, --json.\n");
    // An option meant for another command must not be ignored: apply --readonly would still write.
    const r = await cli(["apply", "alpha", "-", "--sha", sha(ALPHA), "--readonly"], { stdin: "changed" });
    expect(r.err).toMatch(/apply doesn't take --readonly/);
    expect(readNote("alpha.md")).toBe(ALPHA);
  });

  it("refuses an option with a missing or empty value, and a value on a switch", async () => {
    expect((await cli(["check", "--project="])).err).toBe("memory-audit: --project needs a value.\n");
    expect((await cli(["check", "--project"])).err).toBe("memory-audit: --project needs a value.\n");
    expect((await cli(["check", "--json=yes"])).err).toBe("memory-audit: --json doesn't take a value.\n");
  });

  it("doesn't treat built-in object names as commands", async () => {
    expect((await cli(["toString"])).err).toMatch(/Unknown command "toString"/);
  });

  it("takes an id that exists on disk even if it isn't a project folder", async () => {
    writeFileSync(path.join(sb.projects, "stray"), "");
    expect((await cli(["check", "--project", "stray"])).err).toMatch(/Project not found/);
    writeFileSync(path.join(sb.projects, "-srv-stray"), ""); // the same, found by path
    expect((await cli(["check", "--project", "/srv/stray"])).err).toMatch(/Project not found/);
  });
});

describe("check", () => {
  it("prints JSON with any saved AI results", async () => {
    const r = JSON.parse((await cli(["check", "--json"])).out);
    expect(r.projectId).toBe(PROJECT);
    expect(r.aiResults).toEqual({ "alpha.md": null });
  });

  it("summarises project problems, flagged notes with evidence, and quiet notes", async () => {
    const saved = (file: string) => {
      const dir = path.join(sb.base, "results", PROJECT);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `${file}.json`), JSON.stringify({ file, verdict: "supported", ranAt: "2026-02-02T00:00:00Z", summary: "Fine." }));
    };
    sb.writeNote("MEMORY.md", "- [Alpha](alpha.md)\n- [Gone](gone.md)\n- [Beta](beta.md)\n- [C](c.md)\n");
    sb.writeNote("beta.md", note("Beta", "d", "x"));
    sb.writeNote("c.md", note("C", "d", "y"));
    sb.writeNote("loose.md", "---\nname: loose.md\n---\n"); // name equals the file: printed once
    sb.writeSession("s1", [
      { type: "user", timestamp: "2026-01-01T00:00:00Z", cwd: "/Users/dev/demo", message: { content: "hi" } },
      { type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "/m/memory/beta.md" } }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "/m/memory/c.md" } }] } },
    ]);
    saved("loose.md");
    saved("beta.md");
    const { out } = await cli(["check"]);
    expect(out).toContain("✗ [problem] MEMORY.md: MEMORY.md points to a file that doesn't exist  (fix: remove-broken-links)\n    gone.md");
    expect(out).toContain("! [warning] loose.md\n    - Not listed in MEMORY.md, so new sessions don't know it exists  (fix: add-to-index)");
    expect(out).toContain("    AI check (2026-02-02): supported. Fine.");
    expect(out).toContain("! [warning] alpha.md (Alpha)");
    expect(out).toContain("✓ 2 notes with no warning signs:\n  beta.md  (AI check: supported, 2026-02-02)\n  c.md\n");
    expect(out).toContain("Notes: 0 with problems, 2 with warnings, 2 fine.");
  });

  it("quotes evidence, including undated lines", async () => {
    sb.writeNote("db.md", `---\nname: Postgres database\ndescription: postgres storage\ntype: t\nmodified: 2026-01-01\n---\nx\n`);
    sb.writeNote("MEMORY.md", "- [Alpha](alpha.md)\n- [DB](db.md)\n");
    sb.writeSession("s2", [
      { type: "user", timestamp: "2026-03-01T00:00:00Z", message: { content: "The postgres database is wrong now." } },
      { type: "user", message: { content: "The postgres database is outdated." } },
    ]);
    const { out } = await cli(["check"]);
    expect(out).toContain("      “The postgres database is wrong now.” (user, 2026-03-01)");
    expect(out).toContain("      “The postgres database is outdated.” (user, ?)");
  });

  it("prints project findings that have no fix or detail", async () => {
    rmSync(path.join(sb.memDir, "MEMORY.md"));
    rmSync(path.join(path.dirname(sb.memDir), "s1.jsonl"));
    const { out } = await cli(["check", "--project", PROJECT]);
    expect(out).toContain("✗ [problem] MEMORY.md: There is no MEMORY.md, so none of these notes load automatically\n! [warning]");
  });

  it("says when there are no notes, and singular for one quiet note", async () => {
    rmSync(path.join(sb.memDir, "alpha.md"));
    sb.writeNote("MEMORY.md", "");
    expect((await cli(["check"])).out).toContain("This project has no memory notes yet.");
    sb.writeNote("q.md", note("Q", "d", "x"));
    sb.writeNote("MEMORY.md", "- [Q](q.md)\n");
    sb.writeSession("s1", [{ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "/m/memory/q.md" } }] } }]);
    expect((await cli(["check"])).out).toContain("✓ 1 note with no warning signs:");
  });
});

describe("evidence and save-result", () => {
  const verdict = (o: object = {}) =>
    JSON.stringify({
      verdict: "outdated",
      confidence: "high",
      summary: "s",
      claims: [
        { claim: "alpha", status: "outdated", explanation: "e", evidence: [{ session: "S1", line: 1 }, { session: "S9", line: 1 }] },
        { claim: "beta", status: "supported", explanation: "e", evidence: [] },
      ],
      proposed_note: ALPHA.replace("Alpha body", "Alpha body v2"),
      ...o,
    });

  it("prints the evidence bundle with the note's hash", async () => {
    const { out } = await cli(["evidence", "alpha"]);
    expect(out).toMatch(new RegExp(`^<memory_audit_evidence project="${PROJECT}" note="alpha.md" note_sha="${sha(ALPHA)}" excerpts="1" sessions="1">`));
    expect(out).toContain("<instructions>");
    expect(out.trim().endsWith("</memory_audit_evidence>")).toBe(true);
  });

  it("saves a verdict from stdin (code fences allowed) and shows the proposed diff", async () => {
    const { out } = await cli(["save-result", "alpha.md", "-"], { stdin: "```json\n" + verdict() + "\n```" });
    expect(out).toContain("Saved. Verdict: outdated (low confidence)."); // low: one claim's citation was invented
    expect(out).toContain("Dropped 1 citation that didn't match a real log line.");
    expect(out).toMatch(/ {2}outdated {5}alpha {2}\[“remember alpha first note” line 1\]/);
    expect(out).toContain("  unverified   beta\n");
    expect(out).toContain("1 claim had no real citation, so it counts as unverified.");
    expect(out).toContain(`Proposed fix (note_sha ${sha(ALPHA)}):`);
    expect(out).toContain("- Alpha body\n+ Alpha body v2");
  });

  it("reads the verdict from a file, and says when no fix is proposed", async () => {
    const f = path.join(sb.base, "v.json");
    writeFileSync(f, verdict({ proposed_note: "", claims: [{ claim: "c", status: "supported", explanation: "e", evidence: [{ session: "S8", line: 1 }, { session: "S9", line: 1 }] }, { claim: "d", status: "supported", explanation: "e", evidence: [] }] }));
    const { out } = await cli(["save-result", "alpha", f]);
    expect(out).toContain("Dropped 2 citations");
    expect(out).toContain("2 claims had no real citation, so they count as unverified.");
    expect(out).toContain("No fix proposed");
  });

  it("doesn't mention dropped citations when every citation is real", async () => {
    const { out } = await cli(["save-result", "alpha", "-"], { stdin: verdict({ claims: [{ claim: "c", status: "supported", explanation: "e", evidence: [{ session: "S1", line: 1 }] }] }) });
    expect(out).not.toContain("Dropped");
  });

  it("rejects invalid JSON and the wrong shape", async () => {
    expect((await cli(["save-result", "alpha", "-"], { stdin: "{nope" })).err).toMatch(/isn't valid JSON/);
    expect((await cli(["save-result", "alpha", "-"], { stdin: "{}" })).err).toMatch(/doesn't have the expected shape/);
  });
});

describe("apply and undo", () => {
  it("needs --sha and a non-empty note", async () => {
    expect((await cli(["apply", "alpha"])).err).toMatch(/Pass --sha/);
    expect((await cli(["apply", "alpha", "--sha", "x"], { stdin: "  \n" })).err).toMatch(/The new note is empty/);
  });

  it("updates a note with a diff and backup, then undoes it (and the undo can be undone)", async () => {
    const r = await cli(["apply", "alpha", "-", "--sha", sha(ALPHA)], { stdin: "new body" });
    expect(r.out).toMatch(/^Updated alpha.md\./);
    expect(r.out).toMatch(/Backup: .*Undo with `memory-audit undo alpha.md`/);
    expect(readNote("alpha.md")).toBe("new body\n");
    const u = await cli(["undo", "alpha"]);
    expect(u.out).toMatch(/^Restored alpha.md to the version from .* \(before: Edited from Claude Code/);
    expect(u.out).toContain("The version you just replaced is backed up too");
    expect(readNote("alpha.md")).toBe(ALPHA);
  });

  it("refuses a stale hash", async () => {
    expect((await cli(["apply", "alpha", "-", "--sha", "stale"], { stdin: "x" })).err).toMatch(/changed on disk/);
  });

  it("refuses to create a note that doesn't exist (a mistyped name)", async () => {
    const r = await cli(["apply", "fresh", "-", "--sha", "any"], { stdin: "hello" });
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/fresh.md doesn't exist in this project/);
  });

  it("undo with no backups, and undo of a deleted note", async () => {
    expect((await cli(["undo", "alpha"])).err).toMatch(/has no backups/);
    await cli(["apply", "alpha", "-", "--sha", sha(ALPHA)], { stdin: "v2" });
    rmSync(path.join(sb.memDir, "alpha.md"));
    const u = await cli(["undo", "alpha"]);
    expect(u.out).not.toContain("backed up too");
    expect(readNote("alpha.md")).toBe(ALPHA);
  });
});

describe("index fixes", () => {
  it("adds a note to the index, with and without an existing MEMORY.md", async () => {
    sb.writeNote("beta.md", note("Beta", "d", "x"));
    expect((await cli(["add-to-index", "beta"])).out).toMatch(/beta.md is listed in MEMORY.md.* Backup of the old index: /);
    rmSync(path.join(sb.memDir, "MEMORY.md"));
    expect((await cli(["add-to-index", "beta"])).out).toBe("beta.md is listed in MEMORY.md, so new sessions will load it.\n");
    expect((await cli(["add-to-index", "nope"])).err).toMatch(/Note not found/);
  });

  it("removes broken links", async () => {
    expect((await cli(["remove-broken-links"])).out).toBe("MEMORY.md has no links to missing notes.\n");
    sb.writeNote("MEMORY.md", "- [Alpha](alpha.md)\n- [X](x.md)\n");
    expect((await cli(["remove-broken-links"])).out).toBe("Removed 1 line from MEMORY.md:\n  - [X](x.md)\n");
    sb.writeNote("MEMORY.md", "- [X](x.md)\n- [Y](y.md)\n");
    expect((await cli(["remove-broken-links"])).out).toMatch(/^Removed 2 lines/);
  });
});

describe("ui", () => {
  class FakeApp extends EventEmitter {
    unref = vi.fn();
  }
  const up = (...statuses: (number | Error)[]) => {
    const f = vi.fn();
    for (const s of statuses) {
      if (s instanceof Error) f.mockRejectedValueOnce(s);
      else f.mockResolvedValueOnce(new Response(s === 200 ? "<html><head><title>Memory Audit</title>" : "other app", { status: s }));
    }
    f.mockRejectedValue(new Error("down"));
    vi.stubGlobal("fetch", f);
    return f;
  };
  const tick = (ms: number) => async () => {
    await vi.advanceTimersByTimeAsync(ms);
  };

  // A running Memory Audit: its page, and its project list (by default the same projects this CLI sees).
  const running = (projects: object[] = [{ id: PROJECT }]) => {
    const f = vi.fn(async (url: string) =>
      url.endsWith("/api/claude-code/projects") ? Response.json(projects) : new Response("<title>Memory Audit</title>"),
    );
    vi.stubGlobal("fetch", f);
    return f;
  };

  it("reports Memory Audit when it's already running, and warns that --readonly can't apply to it", async () => {
    running();
    expect((await cli(["ui", "--port", "4000"])).out).toBe("Memory Audit is already running: http://127.0.0.1:4000\n");
    expect((await cli(["ui", "--readonly"])).out).toMatch(/already running[\s\S]*--readonly doesn't apply/);
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("checks the port before anything else", async () => {
    for (const bad of ["abc", "0", "70000"]) expect((await cli(["ui", "--port", bad])).err).toMatch(/--port must be a number from 1 to 65535/);
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("treats a 5xx answer as not ready yet, and another app's page as another app", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    process.env.PATH = "";
    const f = vi.fn()
      .mockResolvedValueOnce(new Response("<title>Memory Audit</title> restarting", { status: 503 }))
      .mockResolvedValue(new Response("<title>Memory Audit</title>"));
    vi.stubGlobal("fetch", f);
    h.spawn.mockReturnValue(new FakeApp());
    expect((await cli(["ui"], { timers: tick(2000) })).out).toMatch(/^Memory Audit is running/);
    expect(h.spawn).toHaveBeenCalled();
    up(404);
    expect((await cli(["ui"])).err).toMatch(/Another app is using port 3210/);
  });

  it("won't mistake another app on the port for Memory Audit", async () => {
    up(404);
    const r = await cli(["ui", "--port", "4000"]);
    expect(r.err).toMatch(/Another app is using port 4000.*--port 4001/);
    up(404);
    expect((await cli(["ui", "--port", "65535"])).err).toMatch(/--port 65534/); // never suggests 65536
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("starts a source checkout in the background and waits for it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const appDir = path.join(sb.base, "checkout");
    mkdirSync(path.join(appDir, "bin"), { recursive: true });
    writeFileSync(path.join(appDir, "bin", "memory-audit.mjs"), "");
    process.env.MEMORY_AUDIT_APP_DIR = appDir;
    up(new Error("down"), 500, 200);
    const app = Object.assign(new FakeApp(), { pid: 4242 });
    h.spawn.mockReturnValue(app);
    const r = await cli(["ui", "--readonly"], { timers: tick(5000) });
    expect(r.out).toBe("Memory Audit is running: http://127.0.0.1:3210\nIt keeps running in the background; stop it with `kill -- -4242`.\n");
    const [bin, args, opts] = h.spawn.mock.calls[0];
    expect(bin).toBe(process.execPath);
    expect(args).toEqual([path.join(appDir, "bin", "memory-audit.mjs"), "--port", "3210", "--no-open", "--readonly"]);
    expect(opts.detached).toBe(true);
    expect(app.unref).toHaveBeenCalled();
  });

  it("leaves out the stop command when the process id is unknown", async () => {
    process.env.PATH = "";
    up(new Error("down"), 200);
    h.spawn.mockReturnValue(new FakeApp());
    expect((await cli(["ui"])).out).toBe("Memory Audit is running: http://127.0.0.1:3210\nIt keeps running in the background.\n");
  });

  it("uses an installed memory-audit command, and reports when it exits", async () => {
    const binDir = path.join(sb.base, "bin");
    mkdirSync(binDir);
    writeFileSync(path.join(binDir, "memory-audit"), "");
    process.env.PATH = binDir;
    process.env.MEMORY_AUDIT_APP_DIR = path.join(sb.base, "no-checkout");
    up();
    // An earlier run's output is already in the log; only this run's lines are shown.
    const logFile = path.join(sb.base, ".memory-audit", "ui.log");
    mkdirSync(path.dirname(logFile), { recursive: true });
    writeFileSync(logFile, "old run ▲ ✓ — multi-byte characters\n");
    const app = new FakeApp();
    h.spawn.mockImplementation(() => {
      writeFileSync(logFile, "Port 3210 is already in use.\n", { flag: "a" });
      queueMicrotask(() => app.emit("exit", 1));
      return app;
    });
    const r = await cli(["ui"]);
    expect(h.spawn.mock.calls[0][0]).toBe(path.join(binDir, "memory-audit"));
    expect(r.err).toBe(
      `memory-audit: Memory Audit couldn't start (${path.join(binDir, "memory-audit")} exited). It said:\nPort 3210 is already in use.\nFull log: ${logFile}\n`,
    );
  });

  it("falls back to npx, and explains when it can't start", async () => {
    process.env.PATH = "";
    up();
    const app = new FakeApp();
    h.spawn.mockImplementation(() => (queueMicrotask(() => app.emit("error", new Error("ENOENT"))), app));
    const r = await cli(["ui"]);
    expect(h.spawn.mock.calls[0].slice(0, 2)).toEqual(["npx", ["--yes", "memory-audit", "--port", "3210", "--no-open"]]);
    expect(r.err).toMatch(/couldn't start \(npx memory-audit exited\)[\s\S]*npm install -g memory-audit/);
    expect(r.err).toMatch(/If it had to be downloaded, check your network connection/);
    expect(readFileSync(path.join(sb.base, ".memory-audit", "ui.log"), "utf8")).toBe("");
  });

  it("gives up after 90 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    delete process.env.PATH;
    up();
    h.spawn.mockReturnValue(new FakeApp());
    const r = await cli(["ui"], { timers: tick(91_000) });
    expect(r.err).toMatch(/still starting after 90 seconds[\s\S]*again in a minute/);
  });

  it("prints the message of an error without a stack", async () => {
    up();
    h.spawn.mockImplementation(() => {
      throw { message: "no stack here" };
    });
    const r = await cli(["ui"]);
    expect(r).toMatchObject({ code: 1, err: "memory-audit: no stack here\n" });
  });
});
