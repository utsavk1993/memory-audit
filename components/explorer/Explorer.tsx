"use client";

import { CircleCheck, FileText, Lock, MessagesSquare, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ProjectAudit } from "@/lib/audit/types";
import type { ProjectDetail, ProjectSummary } from "@/lib/claude-code/types";
import { useJson, type Loadable } from "@/lib/claude-code/useJson";
import { api, getJson } from "@/lib/client";
import { MemoryView } from "./MemoryView";
import { ProjectView } from "./ProjectView";
import { SessionView } from "./SessionView";
import { Sidebar } from "./Sidebar";

export type Selection =
  | { project: string; view: "overview" }
  | { project: string; view: "memory"; file: string }
  | { project: string; view: "session"; id: string; line?: number };

export interface AuditCtx {
  audit: Loadable<ProjectAudit>;
  run: () => void;
  /** Re-read everything from disk after a write, then re-audit. */
  changed: (message: string) => void;
  openEvidence: (sessionId: string, line: number) => void;
}

const API = "/api/claude-code/projects";

export function Explorer() {
  const [sel, setSel] = useState<Selection | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const projects = useJson<ProjectSummary[]>(API, reloadKey);
  const detail = useJson<ProjectDetail>(sel ? `${API}/${encodeURIComponent(sel.project)}` : null, reloadKey);
  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  // Free audit: run automatically when a project opens (it's local and takes about a second).
  const [audits, setAudits] = useState<Record<string, Loadable<ProjectAudit>>>({});
  const [toast, setToast] = useState<string | null>(null);
  const projectId = sel?.project ?? null;
  const runAudit = useCallback((id: string) => {
    setAudits((a) => ({ ...a, [id]: { state: "loading" } }));
    getJson<ProjectAudit>(`${api.project(id)}/audit`)
      .then((data) => setAudits((a) => ({ ...a, [id]: { state: "ready", data } })))
      .catch((e: Error) => setAudits((a) => ({ ...a, [id]: { state: "error", error: e.message } })));
  }, []);
  const select = useCallback(
    (next: Selection | null) => {
      setSel(next);
      if (next && !audits[next.project]) runAudit(next.project);
    },
    [audits, runAudit],
  );
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const auditCtx: AuditCtx | null = projectId
    ? {
        audit: audits[projectId] ?? { state: "loading" },
        run: () => runAudit(projectId),
        changed: (message) => {
          setToast(message);
          setReloadKey((k) => k + 1);
          runAudit(projectId);
        },
        openEvidence: (id, line) => select({ project: projectId, view: "session", id, line }),
      }
    : null;

  const viewKey = sel
    ? `${sel.project}:${sel.view}:${"file" in sel ? sel.file : "id" in sel ? `${sel.id}:${sel.line ?? ""}` : ""}`
    : "none";

  return (
    <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[340px_minmax(0,1fr)]">
      <div className="flex h-[50dvh] min-h-0 flex-col lg:h-auto">
        <Sidebar
          projects={projects}
          detail={detail}
          audit={auditCtx?.audit.state === "ready" ? auditCtx.audit.data : null}
          sel={sel}
          onSelect={select}
          onRefresh={() => {
            refresh();
            if (projectId) runAudit(projectId);
          }}
        />
      </div>

      <section
        key={viewKey}
        aria-label="Viewer"
        className="scroll-thin min-h-[60dvh] overflow-y-auto rounded-xl border border-line bg-panel lg:min-h-0"
      >
        {!sel || !auditCtx ? (
          <Welcome />
        ) : detail.state !== "ready" ? null : sel.view === "overview" ? (
          <ProjectView d={detail.data} ctx={auditCtx} onSelect={select} />
        ) : sel.view === "memory" ? (
          <MemoryView project={detail.data} file={sel.file} reloadKey={reloadKey} ctx={auditCtx} onSelect={select} />
        ) : (
          <SessionView project={detail.data} id={sel.id} line={sel.line} reloadKey={reloadKey} onSelect={select} />
        )}
      </section>

      {toast && (
        <div role="status" className="fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-2 rounded-lg border border-ok/40 bg-panel p-3 text-sm shadow-xl">
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-ok" />
          <span className="flex-1">{toast}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setToast(null)} className="cursor-pointer text-fg-muted hover:text-fg">
            <X aria-hidden className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function Welcome() {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col justify-center gap-6 p-8">
      <div>
        <h2 className="text-xl font-semibold">Your Claude Code memory</h2>
        <p className="mt-2 text-sm leading-6 text-fg-muted">
          Every project you&rsquo;ve opened in Claude Code has a folder on your machine with two things in it. Pick a
          project on the left to look inside.
        </p>
      </div>
      <ul className="space-y-3 text-sm">
        <li className="flex gap-3 rounded-lg border border-line bg-card p-4">
          <FileText aria-hidden className="mt-0.5 size-5 shrink-0 text-warn" />
          <div>
            <p className="font-medium">Memory notes</p>
            <p className="mt-0.5 text-fg-muted">
              What Claude saved to remember next time. <span className="font-mono text-xs">MEMORY.md</span> is the index
              loaded at the start of every session, and each note is its own file.
            </p>
          </div>
        </li>
        <li className="flex gap-3 rounded-lg border border-line bg-card p-4">
          <MessagesSquare aria-hidden className="mt-0.5 size-5 shrink-0 text-info" />
          <div>
            <p className="font-medium">Session logs</p>
            <p className="mt-0.5 text-fg-muted">
              The full record of each conversation: what you said, what Claude said and did, and when it wrote a note.
              This is the evidence the inspector will check notes against.
            </p>
          </div>
        </li>
        <li className="flex gap-3 rounded-lg border border-line bg-card p-4">
          <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-ok" />
          <div>
            <p className="font-medium">How to audit</p>
            <ol className="mt-1 list-decimal space-y-1 pl-4 text-fg-muted">
              <li>Pick a project. Quick checks (plain rules, no AI) run straight away and every note gets a badge.</li>
              <li>Open a flagged note. The Inspector on the right says why, with links to the exact conversation lines.</li>
              <li><b className="text-fg">Check with AI</b> for the real verdict, claim by claim. It uses the Claude account you&rsquo;re signed in to in Claude Code, so there&rsquo;s no key to set up.</li>
              <li>Fix it: apply the suggested fix, mark it unverified, or edit by hand. You review every change, and each one can be undone.</li>
            </ol>
          </div>
        </li>
        <li className="flex gap-3 rounded-lg border border-line bg-card p-4">
          <Lock aria-hidden className="mt-0.5 size-5 shrink-0 text-ok" />
          <div>
            <p className="font-medium">Local and safe</p>
            <p className="mt-0.5 text-fg-muted">
              Runs on your machine only. Notes change only when you click Save, and a backup is kept every time. The AI
              check is the only thing that sends data out, and only when you run it.
            </p>
          </div>
        </li>
      </ul>
    </div>
  );
}
