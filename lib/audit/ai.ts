// AI check: send one note plus the relevant parts of your session logs to an AI model (Claude or NVIDIA), get back a verdict with
// line-level evidence and, when needed, a corrected version of the note. Runs only when you click it.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { BadRequestError } from "../claude-code/reader";
import { buildContext, JSON_SHAPE, Output, saveResult, SYSTEM, toResult, type Out } from "./evidence";
import type { AiConnection, AiEstimate, AiProvider, AiResult } from "./types";

export { lastResult } from "./evidence";

export class AiError extends Error {}

export const MODEL = process.env.MEMORY_AUDIT_MODEL ?? "claude-opus-5-5";
// Claude Opus 5.5 list prices, US$ per million tokens.
const PRICE = { input: 4, output: 20 };
const MAX_OUTPUT = 16_000;
const TYPICAL_OUTPUT = 3_000;

export function hasCredentials() {
  return Boolean(
    process.env.ANTHROPIC_API_KEY ||
      process.env.ANTHROPIC_AUTH_TOKEN ||
      existsSync(path.join(homedir(), ".config", "anthropic")),
  );
}

// ───────────── Providers ─────────────
// Anthropic (Claude) through the official SDK, or NVIDIA's hosted models (e.g. Nemotron) through
// NVIDIA's OpenAI-compatible endpoint. Pick with MEMORY_AUDIT_PROVIDER, or it's chosen from the key you set.

type Provider = AiProvider;
type Call = { out: Out; model: string; inputTokens: number; outputTokens: number; costUsd: number | null };

const NVIDIA_URL = process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
const NVIDIA_MODEL = process.env.MEMORY_AUDIT_NVIDIA_MODEL ?? "nvidia/nemotron-3-super-120b-a12b";

export function provider(): Provider | null {
  const forced = process.env.MEMORY_AUDIT_PROVIDER;
  if (forced === "claude-code" || forced === "anthropic" || forced === "nvidia") return forced;
  if (claudeBin()) return "claude-code";
  if (hasCredentials()) return "anthropic";
  if (process.env.NVIDIA_API_KEY) return "nvidia";
  return null;
}

const NO_KEY =
  "No AI available. Install Claude Code and sign in (recommended), or set ANTHROPIC_API_KEY or NVIDIA_API_KEY, then restart the app.";

// ───────────── Claude Code (your logged-in account, no API key) ─────────────

/** Find the `claude` CLI. The app may be started without your shell's PATH, so also try the usual install places. */
export function claudeBin(): string | null {
  if (process.env.MEMORY_AUDIT_CLAUDE_BIN) return existsSync(process.env.MEMORY_AUDIT_CLAUDE_BIN) ? process.env.MEMORY_AUDIT_CLAUDE_BIN : null;
  const dirs = [
    ...(process.env.PATH ?? "").split(path.delimiter),
    path.join(homedir(), ".local", "bin"),
    path.join(homedir(), ".claude", "local"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  for (const d of dirs) {
    if (!d) continue;
    const p = path.join(d, process.platform === "win32" ? "claude.exe" : "claude");
    if (existsSync(p)) return p;
  }
  return null;
}

// The CLI's validator doesn't accept zod's "$schema" header, so drop it.
const { $schema: _drop, ...OUTPUT_SCHEMA } = z.toJSONSchema(Output) as Record<string, unknown>;
void _drop;

// Variables that would make the child think it's running inside another Claude Code session.
const SESSION_ENV = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_AGENT_SDK_VERSION|CLAUDE_CODE_(ENTRYPOINT|CHILD_SESSION|SESSION_ID|SESSION_ATTENDED|MESSAGING_\w+|EXECPATH|SSE_PORT|EMIT_STARTUP_TIMING|STARTUP_FAILURE_RESULTS))$/;

/** Is the AI check ready to run? For Claude Code this asks `claude auth status`, so nothing is sent anywhere. */
export async function connection(): Promise<AiConnection> {
  const p = provider();
  if (p === "anthropic") return { provider: p, connected: true, account: "Anthropic API key (from your terminal)", fix: null };
  if (p === "nvidia") return { provider: p, connected: true, account: "NVIDIA API key (from your terminal)", fix: null };
  const bin = p === "claude-code" ? claudeBin() : null;
  if (!bin)
    return {
      provider: null,
      connected: false,
      account: null,
      fix: "Install Claude Code and sign in, then click Re-check.",
    };

  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) if (!SESSION_ENV.test(k)) env[k] = v;
  const status = await new Promise<{ loggedIn?: boolean; authMethod?: string; subscriptionType?: string } | null>((resolve) =>
    execFile(bin, ["auth", "status", "--json"], { env: env as NodeJS.ProcessEnv, timeout: 15_000 }, (_e, stdout) => {
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve(null);
      }
    }),
  );
  if (!status?.loggedIn)
    return {
      provider: p,
      connected: false,
      account: null,
      fix: "Claude Code isn't signed in. Run `claude auth login` in a terminal, then click Re-check.",
    };
  const plan = status.subscriptionType ? ` · ${status.subscriptionType[0].toUpperCase()}${status.subscriptionType.slice(1)} plan` : "";
  const account =
    status.authMethod === "claude.ai"
      ? `Claude account${plan}`
      : /key|token/i.test(status.authMethod ?? "")
        ? "Anthropic API key (from your terminal)"
        : "Claude Code";
  return { provider: p, connected: true, account, fix: null };
}

async function callClaudeCode(user: string): Promise<Call> {
  const bin = claudeBin();
  if (!bin) throw new AiError("Claude Code isn't installed (the `claude` command wasn't found).");
  // An empty folder outside your projects, so no project CLAUDE.md or memory is loaded and nothing is logged there.
  const cwd = path.join(tmpdir(), "memory-audit-run");
  await mkdir(cwd, { recursive: true });
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) if (!SESSION_ENV.test(k)) env[k] = v;

  const args = [
    "-p",
    "--output-format", "json",
    "--json-schema", JSON.stringify(OUTPUT_SCHEMA),
    "--system-prompt", SYSTEM,
    "--tools", "", // it can only read what we send; no file, shell or web access
    "--safe-mode", // no CLAUDE.md, plugins, hooks, MCP servers or skills
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-session-persistence", // don't add a session log for the check itself
  ];
  if (process.env.MEMORY_AUDIT_CLAUDE_MODEL) args.push("--model", process.env.MEMORY_AUDIT_CLAUDE_MODEL);

  const { code, stdout, stderr } = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env: env as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 600_000);
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", (b) => (err += b));
    child.on("error", reject);
    child.on("close", (c) => {
      clearTimeout(timer);
      resolve({ code: c, stdout: out, stderr: err });
    });
    child.stdin.end(user);
  }).catch((e: Error) => {
    throw new AiError(`Couldn't start Claude Code: ${e.message}`);
  });

  let data: {
    is_error?: boolean;
    subtype?: string;
    result?: string;
    structured_output?: unknown;
    usage?: { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; output_tokens?: number };
    modelUsage?: Record<string, unknown>;
  };
  try {
    data = JSON.parse(stdout);
  } catch {
    const msg = (stderr || stdout).trim().slice(0, 300);
    throw new AiError(code === null ? "Claude Code took too long and was stopped." : `Claude Code failed: ${msg || `exit code ${code}`}`);
  }
  if (data.is_error) {
    const msg = (data.result ?? data.subtype ?? "unknown error").slice(0, 300);
    if (/log ?in|auth|credential/i.test(msg)) throw new AiError("Claude Code isn't signed in. Run `claude` in a terminal and log in, then try again.");
    if (/limit|quota|usage/i.test(msg)) throw new AiError(`Claude usage limit reached: ${msg}`);
    throw new AiError(`Claude Code error: ${msg}`);
  }
  const parsed = Output.safeParse(data.structured_output);
  if (!parsed.success) throw new AiError("Claude's answer couldn't be read. Try again.");
  const u = data.usage ?? {};
  return {
    out: parsed.data,
    model: Object.keys(data.modelUsage ?? {})[0] ?? "claude (Claude Code)",
    inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    outputTokens: u.output_tokens ?? 0,
    costUsd: null, // counts toward your Claude plan's usage, not billed per token
  };
}

function client() {
  if (!hasCredentials()) throw new AiError(NO_KEY);
  return new Anthropic();
}

function toAiError(e: unknown): never {
  if (e instanceof AiError || e instanceof BadRequestError) throw e;
  if (e instanceof Anthropic.AuthenticationError) throw new AiError("Your Anthropic API key was rejected.");
  if (e instanceof Anthropic.PermissionDeniedError) throw new AiError("Your API key can't use this model.");
  if (e instanceof Anthropic.RateLimitError) throw new AiError("Rate limited by the Anthropic API. Try again in a minute.");
  if (e instanceof Anthropic.APIConnectionError) throw new AiError("Couldn't reach the Anthropic API. Check your connection.");
  if (e instanceof Anthropic.APIError) throw new AiError(`Anthropic API error ${e.status ?? ""}: ${e.message}`);
  throw e;
}

async function callAnthropic(user: string): Promise<Call> {
  const anthropic = client();
  let res;
  try {
    res = await anthropic.beta.messages.parse({
      model: MODEL,
      max_tokens: MAX_OUTPUT,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(Output) },
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
    });
  } catch (e) {
    toAiError(e);
  }
  if (res.stop_reason === "refusal") throw new AiError("Claude declined to review this note.");
  if (res.stop_reason === "max_tokens") throw new AiError("The answer was cut off. Try again.");
  if (!res.parsed_output) throw new AiError("Claude's answer couldn't be read. Try again.");
  return {
    out: res.parsed_output,
    model: res.model,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
    costUsd: (res.usage.input_tokens * PRICE.input + res.usage.output_tokens * PRICE.output) / 1e6,
  };
}

/** Pull the JSON object out of a reply that may include <think> blocks or code fences. */
function extractJson(text: string): unknown {
  const t = text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/g, "");
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no JSON object");
  return JSON.parse(t.slice(a, b + 1));
}

async function callNvidia(user: string): Promise<Call> {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) throw new AiError(NO_KEY);
  const messages = [
    { role: "system", content: `${SYSTEM}\n\n${JSON_SHAPE}` },
    { role: "user", content: user },
  ];
  let lastErr = "";
  // Open models sometimes return malformed JSON; ask once more with the error before giving up.
  for (let attempt = 0; attempt < 2; attempt++) {
    let r: Response;
    try {
      r = await fetch(`${NVIDIA_URL}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ model: NVIDIA_MODEL, messages, temperature: 0.2, max_tokens: MAX_OUTPUT, stream: false }),
        signal: AbortSignal.timeout(300_000),
      });
    } catch {
      throw new AiError("Couldn't reach the NVIDIA API. Check your connection.");
    }
    if (r.status === 401 || r.status === 403) throw new AiError("Your NVIDIA API key was rejected.");
    if (r.status === 404) throw new AiError(`NVIDIA doesn't offer the model ${NVIDIA_MODEL}. Set MEMORY_AUDIT_NVIDIA_MODEL.`);
    if (r.status === 429) throw new AiError("Rate limited by the NVIDIA API. Try again in a minute.");
    if (!r.ok) throw new AiError(`NVIDIA API error ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const data = (await r.json()) as {
      model?: string;
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = data.choices?.[0];
    if (choice?.finish_reason === "length") throw new AiError("The answer was cut off. Try again.");
    const text = choice?.message?.content ?? "";
    try {
      const out = Output.parse(extractJson(text));
      return {
        out,
        model: data.model ?? NVIDIA_MODEL,
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        costUsd: null, // billed as NVIDIA API credits, not a published per-token price
      };
    } catch (e) {
      lastErr = (e as Error).message.slice(0, 300);
      messages.push({ role: "assistant", content: text }, {
        role: "user",
        content: `That reply was not valid JSON for the required shape (${lastErr}). ${JSON_SHAPE}`,
      });
    }
  }
  throw new AiError("The model's answer couldn't be read. Try again, or try another model.");
}

// ───────────── Public API ─────────────

export async function estimate(projectId: string, file: string): Promise<AiEstimate> {
  const ctx = await buildContext(projectId, file);
  const p = provider();
  let inputTokens = Math.ceil((SYSTEM.length + ctx.user.length) / 3.5); // offline estimate
  if (p === "anthropic") {
    try {
      const r = await client().messages.countTokens({
        model: MODEL,
        system: SYSTEM,
        messages: [{ role: "user", content: ctx.user }],
      });
      inputTokens = r.input_tokens;
    } catch (e) {
      toAiError(e);
    }
  }
  const inCost = (inputTokens * PRICE.input) / 1e6;
  return {
    provider: p,
    model:
      p === "nvidia"
        ? NVIDIA_MODEL
        : p === "claude-code"
          ? (process.env.MEMORY_AUDIT_CLAUDE_MODEL ?? "your Claude Code default model")
          : MODEL,
    inputTokens,
    maxOutputTokens: MAX_OUTPUT,
    maxCostUsd: p === "anthropic" ? inCost + (MAX_OUTPUT * PRICE.output) / 1e6 : null,
    typicalCostUsd: p === "anthropic" ? inCost + (TYPICAL_OUTPUT * PRICE.output) / 1e6 : null,
    sessionsUsed: new Set(ctx.excerpts.map((x) => x.session.id)).size,
    excerpts: ctx.excerpts.length,
    apiKeyFound: p !== null,
  };
}

export async function verify(projectId: string, file: string): Promise<AiResult> {
  const ctx = await buildContext(projectId, file);
  const p = provider();
  if (!p) throw new AiError(NO_KEY);
  const res =
    p === "claude-code"
      ? await callClaudeCode(ctx.user)
      : p === "nvidia"
        ? await callNvidia(ctx.user)
        : await callAnthropic(ctx.user);
  const { droppedCitations: _dropped, ...result } = toResult(ctx, file, res.out, { provider: p, ...res });
  void _dropped;
  await saveResult(projectId, result);
  return result;
}
