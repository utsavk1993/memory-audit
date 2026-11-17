// Model and endpoint overrides are read once when lib/audit/ai.ts loads, so they get their own file
// (each test file runs in a fresh module registry).

import { afterAll, describe, expect, it, vi } from "vitest";
import { PROJECT, note, sandbox } from "./fixtures";

const sb = sandbox();
process.env.MEMORY_AUDIT_MODEL = "custom-model";
process.env.NVIDIA_BASE_URL = "https://nv.example/v1";
process.env.MEMORY_AUDIT_NVIDIA_MODEL = "custom-nv";
afterAll(() => sb.cleanup());

describe("overrides", () => {
  it("uses the configured models and NVIDIA endpoint", async () => {
    const { MODEL, verify } = await import("@/lib/audit/ai");
    expect(MODEL).toBe("custom-model");

    sb.writeNote("a.md", note("A", "d", "x"));
    process.env.MEMORY_AUDIT_PROVIDER = "nvidia";
    process.env.NVIDIA_API_KEY = "n";
    const out = { verdict: "supported", confidence: "low", summary: "", claims: [], proposed_note: "" };
    const f = vi.fn<(url: string) => Promise<Response>>(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }] })));
    vi.stubGlobal("fetch", f);
    expect((await verify(PROJECT, "a.md")).model).toBe("custom-nv");
    expect(f.mock.calls[0][0]).toBe("https://nv.example/v1/chat/completions");
  });
});
