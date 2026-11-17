// The `npx memory-audit` launcher (bin/memory-audit.mjs), run as a real process. These cases all exit
// before the web app would start, so they don't need a build.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const BIN = path.join(import.meta.dirname, "..", "bin", "memory-audit.mjs");
const run = (...args: string[]) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", timeout: 10_000 });

let busy: Server | null = null;
afterEach(() => {
  busy?.close();
  busy = null;
});

describe("launcher", () => {
  it("prints the package version", () => {
    const { version } = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8"));
    for (const f of ["--version", "-v"]) {
      const r = run(f);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(version);
    }
  });

  it("rejects unknown options instead of starting the app", () => {
    const r = run("--verbose");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Unknown option: --verbose");
  });

  it("accepts a --port value without treating it as an option", () => {
    for (const bad of ["abc", "0", "99999"]) {
      const r = run("--port", bad);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("--port must be a number from 1 to 65535");
    }
  });

  it("explains a port that is already in use", async () => {
    busy = createServer();
    await new Promise<void>((resolve) => busy!.listen(0, "127.0.0.1", resolve));
    const port = (busy.address() as { port: number }).port;
    const r = await new Promise<{ status: number | null; stderr: string }>((resolve) => {
      // Async spawn: the busy server must keep running on this process's event loop.
      import("node:child_process").then(({ spawn }) => {
        const c = spawn(process.execPath, [BIN, "--port", String(port), "--no-open"]);
        let stderr = "";
        c.stderr.on("data", (b) => (stderr += b));
        c.on("exit", (status) => resolve({ status, stderr }));
      });
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`Port ${port} is already in use`);
    expect(r.stderr).toContain(`--port ${port + 1}`);
  });
});
