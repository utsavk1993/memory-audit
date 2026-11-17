import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// connection() needs a live Next request scope; outside one it only marks the route dynamic.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => {} }));

import { GET as connectionGET } from "@/app/api/claude-code/connection/route";
import { GET as auditGET } from "@/app/api/claude-code/projects/[project]/audit/route";
import { POST as indexFixPOST } from "@/app/api/claude-code/projects/[project]/index-fix/route";
import { GET as aiGET, POST as aiPOST } from "@/app/api/claude-code/projects/[project]/memory/[file]/ai/route";
import { GET as backupsGET, POST as backupsPOST } from "@/app/api/claude-code/projects/[project]/memory/[file]/backups/route";
import { GET as memoryGET } from "@/app/api/claude-code/projects/[project]/memory/[file]/route";
import { POST as writePOST } from "@/app/api/claude-code/projects/[project]/memory/[file]/write/route";
import { GET as projectGET } from "@/app/api/claude-code/projects/[project]/route";
import { GET as projectsGET } from "@/app/api/claude-code/projects/route";
import { GET as sessionGET } from "@/app/api/claude-code/projects/[project]/sessions/[session]/route";
import { AiError } from "@/lib/audit/ai";
import { ConflictError, sha } from "@/lib/audit/writer";
import { BadRequestError, NotFoundError } from "@/lib/claude-code/reader";
import { ForbiddenError, respond } from "@/lib/claude-code/respond";
import { api, getJson, postJson } from "@/lib/client";
import { PROJECT, note, sandbox, type Sandbox } from "./fixtures";

const URL_ = "http://127.0.0.1:3210/api/x";
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) }) as never;
const get = (q = "") => new Request(`${URL_}${q}`);
const post = (body: unknown) =>
  new Request(URL_, {
    method: "POST",
    headers: { host: "127.0.0.1:3210", origin: "http://127.0.0.1:3210", "x-memory-audit": "1" },
    body: JSON.stringify(body),
  });
const json = async (r: Response) => ({ status: r.status, body: await r.json() });

describe("respond", () => {
  const status = async (e: unknown) => (await respond(async () => Promise.reject(e))).status;

  it("returns JSON with no-store on success", async () => {
    const r = await respond(async () => ({ ok: 1 }));
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ ok: 1 });
  });

  it("maps known errors to HTTP status codes and hides unknown ones", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await status(new NotFoundError("x"))).toBe(404);
    expect(await status(new BadRequestError("x"))).toBe(400);
    expect(await status(new ConflictError("x"))).toBe(409);
    expect(await status(new AiError("x"))).toBe(502);
    expect(await status(new ForbiddenError("x"))).toBe(403);
    const r = await respond(async () => Promise.reject(new Error("secret path /Users/x")));
    expect(await json(r)).toEqual({ status: 500, body: { error: "Something went wrong on the local server" } });
  });
});

describe("API routes", () => {
  let sb: Sandbox;
  const alpha = note("Alpha", "first", "body");
  beforeEach(() => {
    sb = sandbox();
    process.env.HOME = sb.base;
    process.env.MEMORY_AUDIT_DATA_DIR = `${sb.base}/results`;
    process.env.MEMORY_AUDIT_CLAUDE_BIN = `${sb.base}/no-claude`;
    process.env.MEMORY_AUDIT_PROVIDER = "";
    for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "NVIDIA_API_KEY"]) delete process.env[k];
    sb.writeNote("MEMORY.md", "- [Alpha](alpha.md)\n- [Gone](gone.md)\n");
    sb.writeNote("alpha.md", alpha);
    sb.writeNote("beta.md", note("Beta", "second", "body"));
    sb.writeSession("s1", [{ type: "user", timestamp: "2026-01-01T00:00:00Z", message: { content: "hi" } }]);
  });
  afterEach(() => sb.cleanup());

  it("serves read-only data", async () => {
    expect((await json(await projectsGET())).body[0].id).toBe(PROJECT);
    expect((await json(await projectGET(get(), ctx({ project: PROJECT })))).body.memory).toHaveLength(3);
    expect((await json(await memoryGET(get(), ctx({ project: PROJECT, file: "alpha.md" })))).body.raw).toBe(alpha);
    expect((await json(await sessionGET(get(), ctx({ project: PROJECT, session: "s1" })))).body.events).toHaveLength(1);
    expect((await json(await auditGET(get(), ctx({ project: PROJECT })))).body.projectId).toBe(PROJECT);
    expect((await json(await connectionGET())).body.connected).toBe(false);
    expect(await json(await memoryGET(get(), ctx({ project: "..", file: "x.md" })))).toMatchObject({ status: 400 });
  });

  it("writes a note, lists and reads its backups, and restores one", async () => {
    const p = { project: PROJECT, file: "alpha.md" };
    const w = await json(await writePOST(post({ raw: "v2", expectedSha: sha(alpha) }), ctx(p)));
    expect(w.status).toBe(200);
    const list = await json(await backupsGET(get(), ctx(p)));
    expect(list.body).toHaveLength(1);
    const id = list.body[0].id;
    expect((await json(await backupsGET(get(`?id=${id}`), ctx(p)))).body).toEqual({ id, raw: alpha });
    expect((await json(await backupsPOST(post({ id }), ctx(p)))).status).toBe(200);
    expect((await json(await memoryGET(get(), ctx(p)))).body.raw).toBe(alpha);
  });

  it("validates write and restore bodies", async () => {
    const p = { project: PROJECT, file: "alpha.md" };
    expect((await writePOST(post({ raw: 1 }), ctx(p))).status).toBe(400);
    expect((await backupsPOST(post({}), ctx(p))).status).toBe(400);
    const r = await json(await writePOST(post({ raw: "v2", expectedSha: "stale", reason: "x".repeat(500) }), ctx(p)));
    expect(r.status).toBe(409);
  });

  it("fixes the index", async () => {
    const p = ctx({ project: PROJECT });
    expect((await indexFixPOST(post({ action: "add-to-index", file: "beta.md" }), p)).status).toBe(200);
    expect((await json(await indexFixPOST(post({ action: "remove-broken-links" }), p))).body.removed).toEqual(["- [Gone](gone.md)"]);
    expect((await indexFixPOST(post({ action: "nope" }), p)).status).toBe(400);
  });

  it("estimates for free, refuses to run without an AI, and returns the last result", async () => {
    const p = ctx({ project: PROJECT, file: "alpha.md" });
    expect((await json(await aiPOST(post({ action: "estimate" }), p))).body.apiKeyFound).toBe(false);
    expect((await aiPOST(post({ action: "run" }), p)).status).toBe(502);
    expect((await aiPOST(post({ action: "nope" }), p)).status).toBe(400);
    expect((await json(await aiGET(get(), p))).body).toEqual({ result: null });
  });

  it("blocks writes without the app's guard headers", async () => {
    const bare = new Request(URL_, { method: "POST", headers: { host: "127.0.0.1:3210" }, body: "{}" });
    expect((await writePOST(bare, ctx({ project: PROJECT, file: "alpha.md" }))).status).toBe(403);
  });
});

describe("browser fetch helpers", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (status: number, body: string) =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status })));

  it("builds encoded API URLs", () => {
    expect(api.project("a/b")).toBe("/api/claude-code/projects/a%2Fb");
    expect(api.note("p", "x y.md")).toBe("/api/claude-code/projects/p/memory/x%20y.md");
  });

  it("postJson sends the app header and returns the body", async () => {
    stub(200, '{"ok":true}');
    await expect(postJson("/u", { a: 1 })).resolves.toEqual({ ok: true });
    const init = vi.mocked(fetch).mock.calls[0][1]!;
    expect((init.headers as Record<string, string>)["x-memory-audit"]).toBe("1");
  });

  it.each([
    [postJson as (u: string, b?: unknown) => Promise<unknown>, "post"],
    [getJson as (u: string) => Promise<unknown>, "get"],
  ])("surfaces server errors (%#)", async (fn) => {
    stub(409, '{"error":"changed"}');
    await expect(fn("/u", {})).rejects.toThrow("changed");
    stub(500, "not json");
    await expect(fn("/u", {})).rejects.toThrow("Request failed (500)");
  });

  it("getJson returns the body", async () => {
    stub(200, "[1]");
    await expect(getJson("/u")).resolves.toEqual([1]);
  });
});
