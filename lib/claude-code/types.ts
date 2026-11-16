// Shapes returned by the local Claude Code reader API. Shared by server and UI.

export interface ProjectSummary {
  id: string; // folder name under ~/.claude/projects, e.g. "-Users-me-projects-app"
  name: string; // last part of the project path
  path: string; // real project path (from the logs), or a best guess from the folder name
  memoryCount: number;
  sessionCount: number;
  updatedAt: string | null; // ISO
}

export interface MemoryFileSummary {
  file: string; // e.g. "plan-before-building.md"
  isIndex: boolean; // MEMORY.md
  name: string | null; // frontmatter name
  description: string | null;
  type: string | null; // user | feedback | project | reference
  size: number;
  updatedAt: string;
  inIndex: boolean; // listed in MEMORY.md
}

export interface SessionSummary {
  id: string;
  title: string;
  size: number;
  updatedAt: string;
  startedAt: string | null;
  messageCount: number; // your messages + Claude's replies
}

export interface ProjectDetail extends ProjectSummary {
  memoryDir: string;
  memory: MemoryFileSummary[];
  sessions: SessionSummary[];
  /** Index lines in MEMORY.md that point to a file that doesn't exist. */
  brokenIndexLinks: string[];
}

export interface MemoryFile {
  file: string;
  sha?: string; // sha256 of raw, used to refuse writes over unseen changes
  absolutePath: string;
  frontmatter: Record<string, string>;
  body: string;
  raw: string;
  updatedAt: string;
}

export type SessionEventKind =
  | "user"
  | "assistant"
  | "tool_use"
  | "tool_result"
  | "memory_write"
  | "context";

export interface SessionEvent {
  index: number; // line number in the .jsonl file (1-based), the stable id for evidence
  kind: SessionEventKind;
  at: string | null;
  text: string;
  tool?: string;
  isError?: boolean;
  truncated?: boolean;
  memoryFile?: string; // for memory_write: which note
}

export interface SessionDetail {
  id: string;
  title: string;
  absolutePath: string;
  startedAt: string | null;
  endedAt: string | null;
  lineCount: number;
  skippedLines: number; // bookkeeping lines hidden from the view
  events: SessionEvent[];
}
