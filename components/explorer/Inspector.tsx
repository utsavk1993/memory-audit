"use client";

import {
  CircleHelp,
  History,
  Loader2,
  PencilLine,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AiEstimate, AiResult, Backup, NoteAudit } from "@/lib/audit/types";
import type { MemoryFile } from "@/lib/claude-code/types";
import { api, getJson, postJson } from "@/lib/client";
import { diffLines, markUnverified } from "@/lib/diff";
import { cx } from "../ui";
import { Badge, EvidenceList, FindingRow, VERDICT, VerdictBadge } from "./audit-ui";
import { fmtDate } from "./format";

type Draft = { raw: string; reason: string; title: string };

export function Inspector({
  projectId,
  note,
  audit,
  auditing,
  onChanged,
  onEvidence,
}: {
  projectId: string;
  note: MemoryFile;
  audit: NoteAudit | null;
  auditing: boolean;
  onChanged: (message: string) => void;
  onEvidence: (sessionId: string, line: number) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isIndex = note.file === "MEMORY.md";

  const addToIndex = async () => {
    setBusy(true);
    setErr(null);
    try {
      await postJson(`${api.project(projectId)}/index-fix`, { action: "add-to-index", file: note.file });
      onChanged("Added to MEMORY.md. A backup of the old index was kept.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 1. Free checks */}
      <section className="rounded-xl border border-line bg-card p-4">
        <header className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck aria-hidden className="size-4 text-ok" /> Inspector
          </h3>
          {auditing ? (
            <span className="flex items-center gap-1.5 text-xs text-fg-muted">
              <Loader2 aria-hidden className="size-3.5 animate-spin" /> Checking…
            </span>
          ) : (
            audit && <Badge s={audit.status} />
          )}
        </header>
        <p className="mb-3 text-xs leading-5 text-fg-muted">
          <b className="text-fg">Quick checks, no AI.</b> Plain rules run on your machine: is the note loaded, does the
          conversation that wrote it still exist, do the files it mentions exist, did you say &ldquo;no longer&rdquo; or
          &ldquo;that&rsquo;s wrong&rdquo; about it later. Fast and private, but they only spot warning signs. The AI check
          below reads the evidence and decides.
        </p>
        {isIndex ? (
          <p className="text-xs text-fg-muted">MEMORY.md is checked as part of the project audit on the Overview page.</p>
        ) : audit ? (
          <ul className="space-y-2">
            {audit.findings.map((f) => (
              <FindingRow
                key={f.code}
                f={f}
                onEvidence={onEvidence}
                fixLabel={f.fix === "add-to-index" ? "Add to MEMORY.md" : undefined}
                onFix={f.fix === "add-to-index" ? addToIndex : undefined}
                busy={busy}
              />
            ))}
          </ul>
        ) : (
          !auditing && <p className="text-xs text-fg-muted">No results yet.</p>
        )}
        {err && <p className="mt-2 text-xs text-bad">{err}</p>}
      </section>

      {/* 2. AI check */}
      {!isIndex && <AiCheck projectId={projectId} note={note} onEvidence={onEvidence} onFix={setDraft} />}

      {/* 3. Fix */}
      <section className="rounded-xl border border-line bg-card p-4">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <PencilLine aria-hidden className="size-4 text-info" /> Fix this note
        </h3>
        <p className="mb-3 text-xs leading-5 text-fg-muted">
          You always see the exact change first. The old version is backed up to{" "}
          <span className="font-mono">~/.memory-audit/backups</span> and can be restored below.
        </p>
        <div className="flex flex-wrap gap-2">
          {!isIndex && (
            <button
              type="button"
              onClick={() =>
                setDraft({
                  title: "Mark as unverified",
                  reason: "Marked as unverified",
                  raw: markUnverified(note.raw, "Memory Audit could not confirm this from the session logs."),
                })
              }
              className="flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md bg-guess/15 px-2.5 text-xs font-medium text-guess transition-colors duration-150 hover:bg-guess/25"
            >
              <CircleHelp aria-hidden className="size-3.5" /> Mark as unverified
            </button>
          )}
          <button
            type="button"
            onClick={() => setDraft({ title: "Edit by hand", reason: "Edited by hand", raw: note.raw })}
            className="flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md border border-line px-2.5 text-xs font-medium text-fg-muted transition-colors duration-150 hover:border-line-strong hover:text-fg"
          >
            <PencilLine aria-hidden className="size-3.5" /> Edit by hand
          </button>
        </div>
        <BackupList projectId={projectId} file={note.file} sha={note.sha ?? ""} onRestored={onChanged} />
      </section>

      {draft && (
        <FixReview
          projectId={projectId}
          note={note}
          draft={draft}
          onClose={() => setDraft(null)}
          onSaved={(msg) => {
            setDraft(null);
            onChanged(msg);
          }}
        />
      )}
    </div>
  );
}

// ───────────── AI check ─────────────

type AiState =
  | { s: "idle" }
  | { s: "estimating" }
  | { s: "estimate"; est: AiEstimate }
  | { s: "running"; est: AiEstimate }
  | { s: "error"; error: string };

const usd = (n: number | null) => (n === null ? "n/a" : n < 0.01 ? "under $0.01" : `$${n.toFixed(2)}`);

function AiCheck({
  projectId,
  note,
  onEvidence,
  onFix,
}: {
  projectId: string;
  note: MemoryFile;
  onEvidence: (sessionId: string, line: number) => void;
  onFix: (d: Draft) => void;
}) {
  const url = `${api.note(projectId, note.file)}/ai`;
  const [state, setState] = useState<AiState>({ s: "idle" });
  const [result, setResult] = useState<AiResult | null>(null);

  useEffect(() => {
    let live = true;
    getJson<{ result: AiResult | null }>(url)
      .then((r) => live && setResult(r.result))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [url]);

  const estimate = async () => {
    setState({ s: "estimating" });
    try {
      setState({ s: "estimate", est: await postJson<AiEstimate>(url, { action: "estimate" }) });
    } catch (e) {
      setState({ s: "error", error: (e as Error).message });
    }
  };
  const run = async (est: AiEstimate) => {
    setState({ s: "running", est });
    try {
      setResult(await postJson<AiResult>(url, { action: "run" }));
      setState({ s: "idle" });
    } catch (e) {
      setState({ s: "error", error: (e as Error).message });
    }
  };
  const stale = result && note.updatedAt > result.ranAt;

  return (
    <section className="rounded-xl border border-guess/30 bg-card p-4">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <Sparkles aria-hidden className="size-4 text-guess" /> AI check
      </h3>
      <p className="mb-3 text-xs leading-5 text-fg-muted">
        Claude reads this note and the related parts of your session logs, then says whether each claim is
        supported, out of date, wrong, or a guess, citing the exact lines. It uses your own Claude Code account, and
        you see what will be sent before it runs.
      </p>

      {state.s === "idle" && (
        <button
          type="button"
          onClick={estimate}
          className="min-h-9 cursor-pointer rounded-md bg-guess/15 px-3 text-xs font-medium text-guess transition-colors duration-150 hover:bg-guess/25"
        >
          {result ? "Check again" : "Check with AI"} · see cost first
        </button>
      )}
      {state.s === "estimating" && (
        <p className="flex items-center gap-2 text-xs text-fg-muted">
          <Loader2 aria-hidden className="size-3.5 animate-spin" /> Gathering evidence and counting tokens…
        </p>
      )}
      {(state.s === "estimate" || state.s === "running") && (
        <div className="space-y-2 rounded-lg border border-line bg-bg p-3 text-xs">
          {!state.est.apiKeyFound ? (
            <p className="flex gap-2 text-warn">
              <TriangleAlert aria-hidden className="size-4 shrink-0" />
              No AI available. Install Claude Code and sign in (run <span className="font-mono">claude</span> in a
              terminal), then restart this app.
            </p>
          ) : (
            <>
              <p className="text-fg">
                Sends this note plus <b>{state.est.excerpts}</b> excerpts from <b>{state.est.sessionsUsed}</b> session
                {state.est.sessionsUsed === 1 ? "" : "s"} (about {state.est.inputTokens.toLocaleString()} tokens) to{" "}
                <span className="font-mono">{state.est.model}</span> via{" "}
                {state.est.provider === "claude-code"
                  ? "your Claude Code account"
                  : state.est.provider === "nvidia"
                    ? "NVIDIA"
                    : "the Anthropic API"}
                .
              </p>
              {state.est.provider === "nvidia" ? (
                <p className="flex gap-1.5 text-warn">
                  <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                  These log excerpts will be sent to NVIDIA, a company that hasn&rsquo;t seen them before.
                </p>
              ) : (
                <p className="text-fg-muted">
                  Goes to Anthropic only, where these conversations were already sent when you had them. No tools, no
                  file access: Claude only sees the excerpts above.
                </p>
              )}
              {state.est.provider === "claude-code" ? (
                <p className="text-fg-muted">No API key, no extra bill. It counts toward your Claude plan&rsquo;s usage.</p>
              ) : state.est.typicalCostUsd !== null ? (
                <p className="text-fg-muted">
                  Usually about <b className="text-fg">{usd(state.est.typicalCostUsd)}</b>, never more than{" "}
                  {usd(state.est.maxCostUsd)}.
                </p>
              ) : (
                <p className="text-fg-muted">
                  Uses your NVIDIA API credits. NVIDIA doesn&rsquo;t publish a per-token price for this.
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  disabled={state.s === "running"}
                  onClick={() => run(state.est)}
                  className="flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md bg-guess px-3 font-medium text-bg transition-opacity duration-150 hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
                >
                  {state.s === "running" ? (
                    <>
                      <Loader2 aria-hidden className="size-3.5 animate-spin" /> Checking… (can take a minute or two)
                    </>
                  ) : (
                    "Run the check"
                  )}
                </button>
                {state.s === "estimate" && (
                  <button
                    type="button"
                    onClick={() => setState({ s: "idle" })}
                    className="min-h-8 cursor-pointer rounded-md px-3 text-fg-muted hover:text-fg"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
      {state.s === "error" && (
        <div className="rounded-lg border border-bad/40 bg-bad/8 p-3 text-xs text-bad">
          {state.error}{" "}
          <button type="button" onClick={() => setState({ s: "idle" })} className="ml-1 cursor-pointer underline">
            OK
          </button>
        </div>
      )}

      {result && (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <VerdictBadge v={result.verdict} />
            <span className="text-[11px] text-fg-subtle">
              {result.confidence} confidence · {result.model} · {fmtDate(result.ranAt)}
              {result.usage.costUsd !== null && <> · cost {usd(result.usage.costUsd)}</>}
            </span>
          </div>
          {stale && <p className="text-[11px] text-warn">The note changed after this check. Run it again for a fresh result.</p>}
          <p className="text-sm leading-6">{result.summary}</p>
          <ul className="space-y-2">
            {result.reasons.map((r, i) => {
              const v = VERDICT[r.status];
              return (
                <li key={i} className={cx("rounded-lg border p-3", v.border, v.bg)}>
                  <p className="flex items-start gap-2 text-[13px] font-medium leading-5">
                    <v.icon aria-hidden className={cx("mt-0.5 size-4 shrink-0", v.text)} /> {r.claim}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-fg-muted">{r.explanation}</p>
                  <EvidenceList evidence={r.evidence} onOpen={onEvidence} />
                </li>
              );
            })}
          </ul>
          {result.proposedRaw && !stale && (
            <button
              type="button"
              onClick={() => onFix({ title: "Apply the AI's suggested fix", reason: `AI fix (${result.verdict})`, raw: result.proposedRaw! })}
              className="min-h-9 w-full cursor-pointer rounded-md bg-info px-3 text-xs font-semibold text-bg transition-opacity duration-150 hover:opacity-90"
            >
              Review the suggested fix
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ───────────── Review a change before writing it ─────────────

function FixReview({
  projectId,
  note,
  draft,
  onClose,
  onSaved,
}: {
  projectId: string;
  note: MemoryFile;
  draft: Draft;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [text, setText] = useState(draft.raw);
  const [editing, setEditing] = useState(draft.title === "Edit by hand");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const diff = useMemo(() => diffLines(note.raw, text), [note.raw, text]);
  const changed = text !== note.raw;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      await postJson(`${api.note(projectId, note.file)}/write`, { raw: text, expectedSha: note.sha, reason: draft.reason });
      onSaved(`Saved ${note.file}. The previous version is backed up; use Restore to undo.`);
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={draft.title} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3">
      <div className="flex max-h-[92dvh] w-full max-w-4xl flex-col rounded-xl border border-line bg-panel shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-line p-4">
          <div>
            <h2 className="text-base font-semibold">{draft.title}</h2>
            <p className="text-xs text-fg-muted">
              Review the change to <span className="font-mono">{note.file}</span>. Nothing is written until you click Save.
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-fg-muted hover:bg-muted hover:text-fg">
            <X aria-hidden className="size-4" />
          </button>
        </header>
        <div className="flex gap-2 border-b border-line px-4 py-2 text-xs">
          {(["Changes", "Edit text"] as const).map((t, i) => (
            <button
              key={t}
              type="button"
              aria-pressed={editing === (i === 1)}
              onClick={() => setEditing(i === 1)}
              className={cx("min-h-8 cursor-pointer rounded-md px-2.5", editing === (i === 1) ? "bg-card text-fg" : "text-fg-muted hover:text-fg")}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-auto p-4">
          {editing ? (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              aria-label="Note text"
              className="h-[55dvh] w-full resize-none rounded-lg border border-line bg-bg p-3 font-mono text-xs leading-5 outline-none focus:border-info"
            />
          ) : !changed ? (
            <p className="text-sm text-fg-muted">No changes yet.</p>
          ) : (
            <pre className="overflow-x-auto rounded-lg border border-line bg-bg py-2 font-mono text-xs leading-5">
              {diff.map((d, i) => (
                <div
                  key={i}
                  className={cx(
                    "whitespace-pre-wrap break-words px-3",
                    d.kind === "add" && "bg-ok/12 text-ok",
                    d.kind === "del" && "bg-bad/12 text-bad line-through decoration-bad/40",
                    d.kind === "same" && "text-fg-muted",
                  )}
                >
                  <span aria-hidden className="mr-2 select-none opacity-60">{d.kind === "add" ? "+" : d.kind === "del" ? "−" : " "}</span>
                  {d.text || " "}
                </div>
              ))}
            </pre>
          )}
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line p-4">
          <p className="text-xs text-bad">{err}</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="min-h-9 cursor-pointer rounded-md px-3 text-xs text-fg-muted hover:text-fg">
              Cancel
            </button>
            <button
              type="button"
              disabled={!changed || saving}
              onClick={save}
              className="min-h-9 cursor-pointer rounded-md bg-ok px-4 text-xs font-semibold text-bg transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save (keeps a backup)"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ───────────── Backups / undo ─────────────

function BackupList({
  projectId,
  file,
  sha,
  onRestored,
}: {
  projectId: string;
  file: string;
  sha: string;
  onRestored: (msg: string) => void;
}) {
  const url = `${api.note(projectId, file)}/backups`;
  const [list, setList] = useState<Backup[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getJson<Backup[]>(url)
      .then((b) => live && setList(b))
      .catch(() => live && setList([]));
    return () => {
      live = false;
    };
  }, [url, sha]);

  if (!list?.length) return null;
  const restore = async (id: string) => {
    setBusy(id);
    setErr(null);
    try {
      await postJson(url, { id });
      onRestored("Restored the backup. The version it replaced was backed up too.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
        <History aria-hidden className="size-3.5" /> Earlier versions ({list.length})
      </p>
      <ul className="space-y-1">
        {list.slice(0, 8).map((b, i) => (
          <li key={b.id} className="flex items-center justify-between gap-2 rounded-md bg-bg px-2.5 py-1.5 text-xs">
            <span className="min-w-0 truncate text-fg-muted">
              {fmtDate(b.createdAt)} · before “{b.reason}”
            </span>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => restore(b.id)}
              className="flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-info hover:bg-info/10 disabled:opacity-50"
            >
              {i === 0 ? <Undo2 aria-hidden className="size-3" /> : <RotateCcw aria-hidden className="size-3" />}
              {busy === b.id ? "Restoring…" : i === 0 ? "Undo last change" : "Restore"}
            </button>
          </li>
        ))}
      </ul>
      {err && <p className="mt-1 text-xs text-bad">{err}</p>}
    </div>
  );
}
