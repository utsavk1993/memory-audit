// A throwaway ~/.claude/projects tree and backup folder per test, wired in through the same
// environment variables the app reads, so nothing touches the real home directory.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const PROJECT = "-Users-dev-demo";

export interface Sandbox {
  base: string;
  projects: string;
  backups: string;
  memDir: string;
  writeNote(file: string, content: string): string;
  writeSession(id: string, lines: (object | string)[]): string;
  cleanup(): void;
}

export function sandbox(): Sandbox {
  const base = mkdtempSync(path.join(tmpdir(), "memory-audit-test-"));
  const projects = path.join(base, "projects");
  const backups = path.join(base, "backups");
  const projectDir = path.join(projects, PROJECT);
  const memDir = path.join(projectDir, "memory");
  mkdirSync(memDir, { recursive: true });

  // Tests may change any variable (HOME, API keys, …); put the whole environment back afterwards.
  const envBefore = { ...process.env };
  process.env.MEMORY_AUDIT_CLAUDE_DIR = projects;
  process.env.MEMORY_AUDIT_BACKUP_DIR = backups;
  process.env.MEMORY_AUDIT_DATA_DIR = path.join(base, "results");
  delete process.env.MEMORY_AUDIT_READONLY;

  return {
    base,
    projects,
    backups,
    memDir,
    writeNote(file, content) {
      const p = path.join(memDir, file);
      writeFileSync(p, content);
      return p;
    },
    writeSession(id, lines) {
      const p = path.join(projectDir, `${id}.jsonl`);
      writeFileSync(p, lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n");
      return p;
    },
    cleanup() {
      for (const k of Object.keys(process.env)) if (!(k in envBefore)) delete process.env[k];
      Object.assign(process.env, envBefore);
      rmSync(base, { recursive: true, force: true });
    },
  };
}

export const note = (name: string, description: string, body: string, type = "project") =>
  `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  type: ${type}\n---\n\n${body}\n`;
