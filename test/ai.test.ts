// The AI check, with every external boundary mocked: the `claude` CLI (child_process), the Anthropic SDK,
// NVIDIA's HTTP API (fetch) and the filesystem lookups used to find the CLI. Nothing leaves the machine.

import { EventEmitter } from "node:events";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECT, note, sandbox, type Sandbox } from "./fixtures";

const h = vi.hoisted(() => ({
  files: new Set<string>(),
  execFile: vi.fn(),
  spawn: vi.fn(),
  parse: vi.fn(),
  countTokens: vi.fn(),
}));

vi.mock("node:fs", async (orig) => ({ ...(await orig<typeof import("node:fs")>()), existsSync: (p: string) => h.files.has(p) }));
vi.mock("node:child_process", () => ({ execFile: h.execFile, spawn: h.spawn }));
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    constructor(
      public status?: number,
      message = "boom",
    ) {
      super(message);
    }
  }
  class AuthenticationError extends APIError {}
  class PermissionDeniedError extends APIError {}
  class RateLimitError extends APIError {}
  class APIConnectionError extends APIError {}
  class Anthropic {
    static APIError = APIError;
    static AuthenticationError = AuthenticationError;
    static PermissionDeniedError = PermissionDeniedError;
    static RateLimitError = RateLimitError;
    static APIConnectionError = APIConnectionError;
    beta = { messages: { parse: h.parse } };
    messages = { countTokens: h.countTokens };
  }
  return { default: Anthropic };
});

import Anthropic from "@anthropic-ai/sdk";
import { AiError, MODEL, claudeBin, connection, estimate, hasCredentials, lastResult, provider, verify } from "@/lib/audit/ai";
import { BadRequestError } from "@/lib/claude-code/reader";

type Err = new (status?: number, message?: string) => Error;
const SDK = Anthropic as unknown as Record<string, Err>;

const OUT = {
  verdict: "outdated",
  confidence: "high",
  summary: "Changed.",
  claims: [{ claim: "uses pg", status: "outdated", explanation: "switched", evidence: [{ session: "S1", line: 1 }] }],
  proposed_note: "fixed",
};

let sb: Sandbox;
const BIN = "/fake/bin/claude";

beforeEach(() => {
  sb = sandbox();
  sb.writeNote("db.md", note("Postgres", "postgres storage", "We use Postgres."));
  sb.writeSession("s1", [{ type: "user", timestamp: "2026-01-01T00:00:00Z", message: { content: "postgres storage" } }]);
  process.env.HOME = sb.base;
  process.env.PATH = "";
  for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "NVIDIA_API_KEY", "MEMORY_AUDIT_PROVIDER", "MEMORY_AUDIT_CLAUDE_BIN", "MEMORY_AUDIT_CLAUDE_MODEL"])
    delete process.env[k];
  h.files.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  sb.cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ───────────── Provider selection ─────────────

describe("choosing a provider", () => {
  it("has a default model", () => {
    expect(MODEL).toBe("claude-opus-5-5");
  });

  it("detects Anthropic credentials from either variable or the config folder", () => {
    expect(hasCredentials()).toBe(false);
    process.env.ANTHROPIC_AUTH_TOKEN = "t";
    expect(hasCredentials()).toBe(true);
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    h.files.add(path.join(sb.base, ".config", "anthropic"));
    expect(hasCredentials()).toBe(true);
  });

  it("honours MEMORY_AUDIT_PROVIDER, else prefers Claude Code, then an Anthropic key, then NVIDIA", () => {
    expect(provider()).toBeNull();
    process.env.NVIDIA_API_KEY = "n";
    expect(provider()).toBe("nvidia");
    process.env.ANTHROPIC_API_KEY = "a";
    expect(provider()).toBe("anthropic");
    process.env.MEMORY_AUDIT_CLAUDE_BIN = BIN;
    h.files.add(BIN);
    expect(provider()).toBe("claude-code");
    for (const p of ["claude-code", "anthropic", "nvidia"]) {
      process.env.MEMORY_AUDIT_PROVIDER = p;
      expect(provider()).toBe(p);
    }
    process.env.MEMORY_AUDIT_PROVIDER = "other";
    expect(provider()).toBe("claude-code");
  });

  it("finds the claude CLI from an override, PATH or the usual install folders", () => {
    process.env.MEMORY_AUDIT_CLAUDE_BIN = BIN;
    expect(claudeBin()).toBeNull();
    h.files.add(BIN);
    expect(claudeBin()).toBe(BIN);
    delete process.env.MEMORY_AUDIT_CLAUDE_BIN;
    process.env.PATH = ["", "/a", "/b"].join(path.delimiter);
    h.files.add("/b/claude");
    expect(claudeBin()).toBe("/b/claude");
    delete process.env.PATH;
    h.files.add(path.join(sb.base, ".local", "bin", "claude"));
    expect(claudeBin()).toBe(path.join(sb.base, ".local", "bin", "claude"));
  });

  it("looks for claude.exe on Windows", () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      h.files.add("/usr/local/bin/claude.exe");
      expect(claudeBin()).toBe("/usr/local/bin/claude.exe");
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });
});

// ───────────── Connection status ─────────────

describe("connection", () => {
  const status = (stdout: string) =>
    h.execFile.mockImplementation((_bin, _args, _opts, cb: (e: null, out: string) => void) => cb(null, stdout));

  it("reports API-key providers as connected without running anything", async () => {
    process.env.ANTHROPIC_API_KEY = "a";
    expect(await connection()).toMatchObject({ provider: "anthropic", connected: true });
    delete process.env.ANTHROPIC_API_KEY;
    process.env.NVIDIA_API_KEY = "n";
    expect(await connection()).toMatchObject({ provider: "nvidia", connected: true });
    expect(h.execFile).not.toHaveBeenCalled();
  });

  it("explains how to fix a missing CLI", async () => {
    expect(await connection()).toMatchObject({ provider: null, connected: false, fix: expect.stringMatching(/Install Claude Code/) });
    process.env.MEMORY_AUDIT_PROVIDER = "claude-code";
    expect(await connection()).toMatchObject({ provider: null, connected: false });
  });

  describe("with the claude CLI", () => {
    beforeEach(() => {
      process.env.MEMORY_AUDIT_CLAUDE_BIN = BIN;
      h.files.add(BIN);
    });

    it("asks `claude auth status`, without leaking the parent session's variables", async () => {
      process.env.CLAUDECODE = "1";
      process.env.CLAUDE_CODE_SESSION_ID = "x";
      status('{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"max"}');
      expect(await connection()).toEqual({ provider: "claude-code", connected: true, account: "Claude account · Max plan", fix: null });
      const [bin, args, opts] = h.execFile.mock.calls[0];
      expect([bin, args]).toEqual([BIN, ["auth", "status", "--json"]]);
      expect(opts.env).not.toHaveProperty("CLAUDECODE");
      expect(opts.env).not.toHaveProperty("CLAUDE_CODE_SESSION_ID");
      expect(opts.env).toHaveProperty("HOME");
    });

    it.each([
      ['{"loggedIn":true,"authMethod":"claude.ai"}', "Claude account"],
      ['{"loggedIn":true,"authMethod":"api_key"}', "Anthropic API key (from your terminal)"],
      ['{"loggedIn":true,"authMethod":"oauth"}', "Claude Code"],
      ['{"loggedIn":true}', "Claude Code"],
    ])("names the account for %s", async (out, account) => {
      status(out);
      expect((await connection()).account).toBe(account);
    });

    it.each(['{"loggedIn":false}', "not json"])("asks you to log in when status is %s", async (out) => {
      status(out);
      expect(await connection()).toMatchObject({ connected: false, fix: expect.stringMatching(/claude auth login/) });
    });
  });
});

// ───────────── Running through Claude Code ─────────────

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { end: vi.fn() };
  kill = vi.fn(() => this.emit("close", null));
}

describe("verify with Claude Code", () => {
  let child: FakeChild;
  beforeEach(() => {
    process.env.MEMORY_AUDIT_CLAUDE_BIN = BIN;
    h.files.add(BIN);
    child = new FakeChild();
    h.spawn.mockReturnValue(child);
  });

  const finish = (stdout: string, stderr = "", code: number | null = 0) =>
    h.spawn.mockImplementation(() => {
      queueMicrotask(() => {
        if (stdout) child.stdout.emit("data", Buffer.from(stdout));
        if (stderr) child.stderr.emit("data", Buffer.from(stderr));
        child.emit("close", code);
      });
      return child;
    });

  it("runs a locked-down CLI with no tools and saves the verdict", async () => {
    process.env.MEMORY_AUDIT_CLAUDE_MODEL = "sonnet";
    finish(
      JSON.stringify({
        structured_output: OUT,
        usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 1, output_tokens: 7 },
        modelUsage: { "claude-x": {} },
      }),
    );
    const r = await verify(PROJECT, "db.md");
    expect(r).toMatchObject({ provider: "claude-code", model: "claude-x", verdict: "outdated", usage: { inputTokens: 16, outputTokens: 7, costUsd: null } });
    expect(r.proposedRaw).toBe("fixed\n");
    expect(await lastResult(PROJECT, "db.md")).toMatchObject({ verdict: "outdated" });
    const [, args, opts] = h.spawn.mock.calls[0];
    expect(args).toEqual(expect.arrayContaining(["-p", "--tools", "", "--safe-mode", "--no-session-persistence", "--model", "sonnet"]));
    expect(opts.cwd).toMatch(/memory-audit-run$/);
    expect(child.stdin.end).toHaveBeenCalledWith(expect.stringContaining("<note file=\"db.md\""));
  });

  it("fills in defaults when usage and model are missing", async () => {
    finish(JSON.stringify({ structured_output: OUT, usage: {} }));
    expect(await verify(PROJECT, "db.md")).toMatchObject({ model: "claude (Claude Code)", usage: { inputTokens: 0, outputTokens: 0 } });
    finish(JSON.stringify({ structured_output: OUT }));
    expect((await verify(PROJECT, "db.md")).usage.inputTokens).toBe(0);
  });

  it.each([
    [{ is_error: true, result: "Please log in" }, /isn't signed in/],
    [{ is_error: true, result: "usage limit hit" }, /usage limit reached: usage limit hit/],
    [{ is_error: true, result: "kaput" }, /Claude Code error: kaput/],
    [{ is_error: true, subtype: "error_max_turns" }, /error_max_turns/],
    [{ is_error: true }, /unknown error/],
    [{ structured_output: { verdict: "nope" } }, /couldn't be read/],
  ])("turns %j into a readable error", async (data, msg) => {
    finish(JSON.stringify(data));
    await expect(verify(PROJECT, "db.md")).rejects.toThrow(msg);
  });

  it.each([
    ["", "bad stderr", 1, /Claude Code failed: bad stderr/],
    ["bad stdout", "", 1, /Claude Code failed: bad stdout/],
    ["", "", 3, /exit code 3/],
  ])("reports unreadable output (stdout %j, stderr %j)", async (stdout, stderr, code, msg) => {
    finish(stdout, stderr, code);
    await expect(verify(PROJECT, "db.md")).rejects.toThrow(msg);
  });

  it("reports a CLI that can't start", async () => {
    h.spawn.mockImplementation(() => {
      queueMicrotask(() => child.emit("error", new Error("ENOENT")));
      return child;
    });
    await expect(verify(PROJECT, "db.md")).rejects.toThrow("Couldn't start Claude Code: ENOENT");
  });

  it("stops the CLI after ten minutes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const p = verify(PROJECT, "db.md");
    await vi.waitFor(() => expect(h.spawn).toHaveBeenCalled());
    vi.advanceTimersByTime(600_000);
    await expect(p).rejects.toThrow("took too long");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("fails clearly when forced to Claude Code without the CLI", async () => {
    h.files.clear();
    process.env.MEMORY_AUDIT_PROVIDER = "claude-code";
    await expect(verify(PROJECT, "db.md")).rejects.toThrow("Claude Code isn't installed");
  });
});

// ───────────── Anthropic API ─────────────

describe("verify and estimate with an Anthropic key", () => {
  beforeEach(() => (process.env.ANTHROPIC_API_KEY = "a"));

  it("returns a priced verdict", async () => {
    h.parse.mockResolvedValue({ stop_reason: "end_turn", parsed_output: OUT, model: "claude-opus-5-5", usage: { input_tokens: 1_000_000, output_tokens: 0 } });
    expect(await verify(PROJECT, "db.md")).toMatchObject({ provider: "anthropic", usage: { costUsd: 4 } });
  });

  it.each([
    [{ stop_reason: "refusal" }, /declined/],
    [{ stop_reason: "max_tokens" }, /cut off/],
    [{ stop_reason: "end_turn", parsed_output: null }, /couldn't be read/],
  ])("handles %j", async (res, msg) => {
    h.parse.mockResolvedValue(res);
    await expect(verify(PROJECT, "db.md")).rejects.toThrow(msg);
  });

  it.each([
    ["AuthenticationError", undefined, "Your Anthropic API key was rejected."],
    ["PermissionDeniedError", undefined, "Your API key can't use this model."],
    ["RateLimitError", undefined, /Rate limited/],
    ["APIConnectionError", undefined, /Couldn't reach the Anthropic API/],
    ["APIError", 529, "Anthropic API error 529: boom"],
    ["APIError", undefined, "Anthropic API error : boom"],
  ])("maps SDK %s to a readable error", async (cls, status, msg) => {
    h.parse.mockRejectedValue(new SDK[cls](status));
    await expect(verify(PROJECT, "db.md")).rejects.toThrow(msg);
  });

  it("passes our own errors and unknown errors through", async () => {
    h.parse.mockRejectedValueOnce(new AiError("ours")).mockRejectedValueOnce(new BadRequestError("bad")).mockRejectedValueOnce(new TypeError("bug"));
    await expect(verify(PROJECT, "db.md")).rejects.toThrow("ours");
    await expect(verify(PROJECT, "db.md")).rejects.toThrow("bad");
    await expect(verify(PROJECT, "db.md")).rejects.toThrow(TypeError);
  });

  it("estimates with the token-counting endpoint", async () => {
    h.countTokens.mockResolvedValue({ input_tokens: 1000 });
    const e = await estimate(PROJECT, "db.md");
    expect(e).toMatchObject({ provider: "anthropic", model: MODEL, inputTokens: 1000, apiKeyFound: true, sessionsUsed: 1, excerpts: 1 });
    expect(e.maxCostUsd).toBeCloseTo(0.004 + 0.32);
    expect(e.typicalCostUsd).toBeCloseTo(0.004 + 0.06);
    h.countTokens.mockRejectedValue(new SDK.AuthenticationError());
    await expect(estimate(PROJECT, "db.md")).rejects.toThrow(/rejected/);
  });

  it("refuses when forced to Anthropic without credentials", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.MEMORY_AUDIT_PROVIDER = "anthropic";
    await expect(verify(PROJECT, "db.md")).rejects.toThrow(/No AI available/);
  });
});

// ───────────── NVIDIA ─────────────

describe("verify with NVIDIA", () => {
  beforeEach(() => (process.env.NVIDIA_API_KEY = "n"));
  const reply = (content: string | undefined, extra: object = {}, status = 200) =>
    new Response(JSON.stringify({ choices: [{ message: { content } }], ...extra }), { status });
  const fetchMock = (...responses: (Response | Error)[]) => {
    const f = vi.fn();
    for (const r of responses) {
      if (r instanceof Error) f.mockRejectedValueOnce(r);
      else f.mockResolvedValueOnce(r);
    }
    vi.stubGlobal("fetch", f);
    return f;
  };

  it("parses JSON wrapped in reasoning and code fences", async () => {
    const f = fetchMock(reply(`<think>hmm {}</think>\n\`\`\`json\n${JSON.stringify(OUT)}\n\`\`\``, { model: "nv", usage: { prompt_tokens: 3, completion_tokens: 4 } }));
    expect(await verify(PROJECT, "db.md")).toMatchObject({ provider: "nvidia", model: "nv", usage: { inputTokens: 3, outputTokens: 4, costUsd: null } });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(init.headers.authorization).toBe("Bearer n");
  });

  it("asks once more after malformed JSON, then succeeds", async () => {
    const f = fetchMock(reply("no json here"), reply(JSON.stringify(OUT)));
    expect(await verify(PROJECT, "db.md")).toMatchObject({ model: "nvidia/nemotron-3-super-120b-a12b", usage: { inputTokens: 0 } });
    const retry = JSON.parse(f.mock.calls[1][1].body).messages;
    expect(retry.at(-1).content).toMatch(/not valid JSON .*no JSON object/);
  });

  it("gives up after two malformed answers", async () => {
    fetchMock(reply("{bad"), new Response("{}", { status: 200 }));
    await expect(verify(PROJECT, "db.md")).rejects.toThrow("The model's answer couldn't be read");
  });

  it.each([
    [401, /key was rejected/],
    [403, /key was rejected/],
    [404, /doesn't offer the model/],
    [429, /Rate limited by the NVIDIA API/],
    [500, /NVIDIA API error 500: oops/],
  ])("maps HTTP %i", async (status, msg) => {
    fetchMock(new Response("oops", { status }));
    await expect(verify(PROJECT, "db.md")).rejects.toThrow(msg);
  });

  it("reports a network failure and a truncated answer", async () => {
    fetchMock(new Error("offline"));
    await expect(verify(PROJECT, "db.md")).rejects.toThrow(/Couldn't reach the NVIDIA API/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "length" }] }))));
    await expect(verify(PROJECT, "db.md")).rejects.toThrow(/cut off/);
  });

  it("refuses when forced to NVIDIA without a key", async () => {
    delete process.env.NVIDIA_API_KEY;
    process.env.MEMORY_AUDIT_PROVIDER = "nvidia";
    await expect(verify(PROJECT, "db.md")).rejects.toThrow(/No AI available/);
  });
});

// ───────────── Estimates and no provider ─────────────

describe("estimate without an API", () => {
  it("estimates offline for NVIDIA, Claude Code and no provider", async () => {
    process.env.NVIDIA_API_KEY = "n";
    expect(await estimate(PROJECT, "db.md")).toMatchObject({ provider: "nvidia", model: "nvidia/nemotron-3-super-120b-a12b", maxCostUsd: null });
    process.env.MEMORY_AUDIT_CLAUDE_BIN = BIN;
    h.files.add(BIN);
    expect((await estimate(PROJECT, "db.md")).model).toBe("your Claude Code default model");
    process.env.MEMORY_AUDIT_CLAUDE_MODEL = "opus";
    expect((await estimate(PROJECT, "db.md")).model).toBe("opus");
    h.files.clear();
    delete process.env.NVIDIA_API_KEY;
    expect(await estimate(PROJECT, "db.md")).toMatchObject({ provider: null, apiKeyFound: false });
    expect(h.countTokens).not.toHaveBeenCalled();
  });

  it("verify refuses with no provider at all", async () => {
    await expect(verify(PROJECT, "db.md")).rejects.toThrow(/No AI available/);
  });
});
