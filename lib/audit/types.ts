// Shapes produced by the inspector. Shared by server and UI.

export type Severity = "ok" | "info" | "warn" | "bad";

export interface Evidence {
  sessionId: string;
  sessionTitle: string;
  line: number; // 1-based line in the session .jsonl file
  at: string | null;
  who: "user" | "assistant" | "tool" | "memory_write";
  quote: string;
}

export interface Finding {
  code: string; // stable id, e.g. "not-indexed"
  severity: Severity;
  title: string; // one plain-English line
  detail?: string;
  evidence?: Evidence[];
  /** A one-click fix the app can apply, when there is one. */
  fix?: "add-to-index" | "remove-broken-links";
}

export interface NoteAudit {
  file: string;
  name: string;
  status: Severity; // worst finding
  findings: Finding[];
}

export interface ProjectAudit {
  projectId: string;
  ranAt: string;
  sessionsRead: number;
  project: Finding[]; // findings about the memory folder as a whole
  notes: NoteAudit[];
  counts: Record<Severity, number>;
}

// ───────────── AI verification ─────────────

export type AiVerdict = "supported" | "outdated" | "contradicted" | "unverified";

/** claude-code = your logged-in Claude Code CLI (no API key). */
export type AiProvider = "claude-code" | "anthropic" | "nvidia";

/** Whether the AI check can run, and which account it would use. */
export interface AiConnection {
  provider: AiProvider | null;
  connected: boolean;
  /** What it's connected through, e.g. "Claude account · Team plan". Null when not connected. */
  account: string | null;
  /** What to do when it isn't connected. */
  fix: string | null;
}

export interface AiEstimate {
  provider: AiProvider | null; // null = nothing available
  model: string;
  inputTokens: number;
  maxOutputTokens: number;
  /** Upper bound in US dollars: all input + the max output. Null when the provider has no published price. */
  maxCostUsd: number | null;
  typicalCostUsd: number | null;
  sessionsUsed: number;
  excerpts: number;
  apiKeyFound: boolean;
}

export interface AiResult {
  file: string;
  ranAt: string;
  provider?: AiProvider;
  model: string;
  verdict: AiVerdict;
  confidence: "low" | "medium" | "high";
  summary: string;
  reasons: { claim: string; status: AiVerdict; explanation: string; evidence: Evidence[] }[];
  /** Full proposed note file (frontmatter + body), or null when no change is needed. */
  proposedRaw: string | null;
  usage: { inputTokens: number; outputTokens: number; costUsd: number | null };
}

// ───────────── Fixes ─────────────

export interface Backup {
  id: string; // timestamp-based
  file: string;
  createdAt: string;
  reason: string;
  size: number;
}
