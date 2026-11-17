// Hosted demo mode (MEMORY_AUDIT_DEMO=1), used only for the public deployment.
// It reads the made-up project in demo/ instead of ~/.claude, never writes, and replays a saved AI answer
// instead of calling a model. Regenerate the data with `node scripts/make-demo-data.mjs`.

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Out } from "./audit/evidence";

export const isDemo = () => process.env.MEMORY_AUDIT_DEMO === "1";

const demoDir = () => path.join(process.cwd(), "demo");

export const demoProjectsRoot = () => path.join(demoDir(), "projects");

export const DEMO_READONLY = "This is a read-only demo, so nothing is saved. Install Memory Audit to fix your own notes.";

export async function demoAnswer(file: string): Promise<Out | null> {
  const all = JSON.parse(await readFile(path.join(demoDir(), "ai-results.json"), "utf8")) as Record<string, Out>;
  return Object.hasOwn(all, file) ? all[file] : null;
}

let fileTimes: Record<string, string> | null = null;

/** When a demo file was last written, by its conversation logs. Vercel resets file times on deploy, so mtimes are useless. */
export function demoFileTime(absPath: string): Date | null {
  fileTimes ??= JSON.parse(readFileSync(path.join(demoDir(), "file-times.json"), "utf8")) as Record<string, string>;
  const t = fileTimes[path.relative(demoProjectsRoot(), absPath)];
  return t ? new Date(t) : null;
}
