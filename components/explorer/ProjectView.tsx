"use client";

import { FileText, FolderOpen, Loader2, MessagesSquare, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { Severity } from "@/lib/audit/types";
import type { ProjectDetail } from "@/lib/claude-code/types";
import { api, postJson } from "@/lib/client";
import { Badge, Dot, FindingRow, SEV } from "./audit-ui";
import { cx } from "../ui";
import { fmtDate, fmtSize, shortHome } from "./format";
import { TypeTag } from "./TypeTag";
import type { AuditCtx, Selection } from "./Explorer";

export function ProjectView({ d, ctx, onSelect }: { d: ProjectDetail; ctx: AuditCtx; onSelect: (s: Selection) => void }) {
  const notes = d.memory.filter((m) => !m.isIndex);
  const status = new Map(ctx.audit.state === "ready" ? ctx.audit.data.notes.map((n) => [n.file, n.status]) : []);

  return (
    <div className="space-y-6 p-5">
      <header>
        <h2 className="text-lg font-semibold">{d.name}</h2>
        <p className="mt-0.5 font-mono text-xs text-fg-muted">{shortHome(d.path)}</p>
        <p className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-fg-subtle">
          <FolderOpen aria-hidden className="size-3.5" /> {shortHome(d.memoryDir)}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Memory notes" value={d.memoryCount} />
        <Stat label="Sessions" value={d.sessions.length} />
        <Stat label="Last activity" value={fmtDate(d.updatedAt)} small />
      </div>

      <AuditPanel d={d} ctx={ctx} onSelect={onSelect} />

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Memory notes</h3>
        {notes.length === 0 ? (
          <p className="text-sm text-fg-muted">This project has no memory notes.</p>
        ) : (
          <ul className="grid gap-2 lg:grid-cols-2">
            {notes.map((m) => (
              <li key={m.file}>
                <button
                  type="button"
                  onClick={() => onSelect({ project: d.id, view: "memory", file: m.file })}
                  className="h-full w-full cursor-pointer rounded-lg border border-line bg-card p-3 text-left transition-colors duration-150 hover:border-line-strong"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium">
                      <FileText aria-hidden className="size-3.5 shrink-0 text-fg-muted" />
                      <span className="truncate">{m.name ?? m.file}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      {m.type && <TypeTag type={m.type} align="right" focusable={false} />}
                      {status.get(m.file) && <Dot s={status.get(m.file)!} />}
                    </span>
                  </span>
                  {m.description && <span className="mt-1 block text-xs leading-5 text-fg-muted">{m.description}</span>}
                  <span className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-fg-subtle">
                    <span>updated {fmtDate(m.updatedAt)}</span>
                    {!m.inIndex && <span className="text-warn">not in MEMORY.md</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Sessions</h3>
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
          {d.sessions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect({ project: d.id, view: "session", id: s.id })}
                className="flex w-full cursor-pointer items-center gap-3 bg-card px-3 py-2.5 text-left transition-colors duration-150 hover:bg-muted"
              >
                <MessagesSquare aria-hidden className="size-4 shrink-0 text-fg-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{s.title}</span>
                  <span className="block text-[11px] text-fg-subtle">
                    {fmtDate(s.startedAt)} · {s.messageCount} messages · {fmtSize(s.size)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value, small }: { label: string; value: string | number; small?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-card p-3">
      <p className="text-[11px] text-fg-subtle">{label}</p>
      <p className={cx("mt-0.5 font-semibold", small ? "text-sm" : "text-xl tabular-nums")}>{value}</p>
    </div>
  );
}

const ORDER: Severity[] = ["bad", "warn", "info", "ok"];

function AuditPanel({ d, ctx, onSelect }: { d: ProjectDetail; ctx: AuditCtx; onSelect: (s: Selection) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const a = ctx.audit;

  const removeBroken = async () => {
    setBusy(true);
    setErr(null);
    try {
      await postJson(`${api.project(d.id)}/index-fix`, { action: "remove-broken-links" });
      ctx.changed("Removed the broken links from MEMORY.md. A backup was kept.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-line bg-card p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck aria-hidden className="size-4 text-ok" /> Quick checks{" "}
            <span className="font-normal text-fg-muted">· no AI</span>
          </h3>
          <p className="mt-0.5 text-xs leading-5 text-fg-muted">
            Simple rules that run on your machine, comparing your notes with{" "}
            {a.state === "ready" ? a.data.sessionsRead : "…"} session log
            {a.state === "ready" && a.data.sessionsRead === 1 ? "" : "s"}. They spot warning signs but can&rsquo;t tell
            whether a note is true. For that, open a flagged note and run the <b className="text-fg">AI check</b>.
          </p>
        </div>
        <button
          type="button"
          onClick={ctx.run}
          disabled={a.state === "loading"}
          className="flex min-h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs text-fg-muted transition-colors duration-150 hover:border-line-strong hover:text-fg disabled:cursor-wait"
        >
          {a.state === "loading" ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <RefreshCw aria-hidden className="size-3.5" />}
          {a.state === "loading" ? "Checking…" : "Run again"}
        </button>
      </header>

      {a.state === "error" && (
        <p className="mt-3 flex items-center gap-2 text-sm text-bad">
          <TriangleAlert aria-hidden className="size-4" /> {a.error}
        </p>
      )}

      {a.state === "ready" && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ORDER.map((s) => {
              const v = SEV[s];
              return (
                <div key={s} className={`rounded-lg border p-2.5 ${v.border} ${v.bg}`}>
                  <p className={`flex items-center gap-1.5 text-[11px] font-medium ${v.text}`}>
                    <v.icon aria-hidden className="size-3.5" /> {v.label}
                  </p>
                  <p className="mt-0.5 text-xl font-semibold tabular-nums">{a.data.counts[s]}</p>
                </div>
              );
            })}
          </div>

          {a.data.project.length > 0 && (
            <ul className="space-y-2">
              {a.data.project.map((f) => (
                <FindingRow
                  key={f.code}
                  f={f}
                  onEvidence={ctx.openEvidence}
                  fixLabel={f.fix === "remove-broken-links" ? "Remove these links from MEMORY.md" : undefined}
                  onFix={f.fix === "remove-broken-links" ? removeBroken : undefined}
                  busy={busy}
                />
              ))}
            </ul>
          )}
          {err && <p className="text-xs text-bad">{err}</p>}

          {a.data.notes.some((n) => n.status === "warn" || n.status === "bad") ? (
            <div>
              <p className="mb-2 text-xs font-semibold text-fg-muted">Notes to look at</p>
              <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                {a.data.notes
                  .filter((n) => n.status === "warn" || n.status === "bad")
                  .map((n) => {
                    const issues = n.findings.filter((f) => f.severity === "warn" || f.severity === "bad");
                    return (
                      <li key={n.file}>
                        <button
                          type="button"
                          onClick={() => onSelect({ project: d.id, view: "memory", file: n.file })}
                          className="flex w-full cursor-pointer items-start gap-3 bg-bg px-3 py-2.5 text-left transition-colors duration-150 hover:bg-muted"
                        >
                          <Badge s={n.status} small />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium">{n.name}</span>
                            <span className="block text-xs leading-5 text-fg-muted">{issues.map((f) => f.title).join(" · ")}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ) : (
            a.data.notes.length > 0 && <p className="text-sm text-ok">No warning signs found by the quick checks.</p>
          )}
        </div>
      )}
    </section>
  );
}
