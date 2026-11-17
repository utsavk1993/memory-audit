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

  const prev = {
    claude: process.env.MEMORY_AUDIT_CLAUDE_DIR,
    backup: process.env.MEMORY_AUDIT_BACKUP_DIR,
    readonly: process.env.MEMORY_AUDIT_READONLY,
  };
  process.env.MEMORY_AUDIT_CLAUDE_DIR = projects;
  process.env.MEMORY_AUDIT_BACKUP_DIR = backups;
  delete process.env.MEMORY_AUDIT_READONLY;

  const restore = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));

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
      restore("MEMORY_AUDIT_CLAUDE_DIR", prev.claude);
      restore("MEMORY_AUDIT_BACKUP_DIR", prev.backup);
      restore("MEMORY_AUDIT_READONLY", prev.readonly);
      rmSync(base, { recursive: true, force: true });
    },
  };
}

export const note = (name: string, description: string, body: string, type = "project") =>
  `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  type: ${type}\n---\n\n${body}\n`;
