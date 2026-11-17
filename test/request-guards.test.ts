import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { BadRequestError } from "@/lib/claude-code/reader";
import { ForbiddenError, guardedJson } from "@/lib/claude-code/respond";
import { proxy } from "@/proxy";

const req = (headers: Record<string, string>, body = "{}") =>
  new Request("http://127.0.0.1:3210/api/x", { method: "POST", headers, body });

const ok = { host: "127.0.0.1:3210", origin: "http://127.0.0.1:3210", "x-memory-audit": "1" };

describe("guardedJson (write / spend endpoints)", () => {
  it("accepts the app's own same-origin request", async () => {
    await expect(guardedJson(req(ok, '{"a":1}'))).resolves.toEqual({ a: 1 });
  });

  it.each([
    ["a non-local Host (DNS rebinding)", { ...ok, host: "evil.example:3210" }],
    ["a missing Origin", { host: ok.host, "x-memory-audit": "1" }],
    ["a cross-site Origin", { ...ok, origin: "https://evil.example" }],
    ["a same-host-different-port Origin", { ...ok, origin: "http://127.0.0.1:9999" }],
    ["an opaque 'null' Origin", { ...ok, origin: "null" }],
    ["a garbage Origin", { ...ok, origin: "::::" }],
    ["a missing app header", { host: ok.host, origin: ok.origin }],
  ])("blocks %s", async (_label, headers) => {
    await expect(guardedJson(req(headers as Record<string, string>))).rejects.toThrow(ForbiddenError);
  });

  it("rejects an invalid JSON body", async () => {
    await expect(guardedJson(req(ok, "{nope"))).rejects.toThrow(BadRequestError);
  });
});

describe("proxy (all /api routes)", () => {
  const call = (host: string) =>
    proxy(new NextRequest("http://127.0.0.1:3210/api/claude-code/projects", { headers: { host } }));

  it.each(["127.0.0.1:3210", "localhost:3210", "[::1]:3210", "localhost"])("allows %s", (host) => {
    expect(call(host).status).toBe(200);
  });

  it.each(["evil.example", "127.0.0.1.evil.example", "localhost.evil.example:3210", "0.0.0.0:3210", ""])(
    "blocks Host %j",
    (host) => {
      expect(call(host).status).toBe(403);
    },
  );
});
