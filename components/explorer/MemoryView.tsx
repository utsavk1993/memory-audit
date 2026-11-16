"use client";

import { Code, FileText, Loader2, MessagesSquare, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { MemoryFile, ProjectDetail } from "@/lib/claude-code/types";
import { useJson } from "@/lib/claude-code/useJson";
import { Markdown } from "../Markdown";
import { Pill, cx } from "../ui";
import { TYPE_STYLE, fmtDate, shortHome } from "./format";
import type { AuditCtx, Selection } from "./Explorer";
import { Inspector } from "./Inspector";

// Frontmatter fields shown in the header rather than the generic list.
const SHOWN = new Set(["name", "description", "type", "originSessionId", "modified"]);

export function MemoryView({
  project,
  file,
  reloadKey,
  ctx,
  onSelect,
}: {
  project: ProjectDetail;
  file: string;
  reloadKey: number;
  ctx: AuditCtx;
  onSelect: (s: Selection) => void;
}) {
  const [raw, setRaw] = useState(false);
  const res = useJson<MemoryFile>(
    `/api/claude-code/projects/${encodeURIComponent(project.id)}/memory/${encodeURIComponent(file)}`,
    reloadKey,
  );

  if (res.state === "loading" || res.state === "idle")
    return (
      <p className="flex items-center gap-2 p-5 text-sm text-fg-muted">
        <Loader2 aria-hidden className="size-4 animate-spin" /> Reading note…
      </p>
    );
  if (res.state === "error")
    return (
      <p className="flex items-center gap-2 p-5 text-sm text-bad">
        <TriangleAlert aria-hidden className="size-4" /> {res.error}
      </p>
    );

  const m = res.data;
  const fm = m.frontmatter;
  const isIndex = file === "MEMORY.md";
  const summary = project.memory.find((x) => x.file === file);
  const origin = fm.originSessionId ? project.sessions.find((s) => s.id === fm.originSessionId) : undefined;
  const byName = new Map(project.memory.map((x) => [x.name ?? x.file.replace(/\.md$/, ""), x.file]));
  const openNote = (f: string) =>
    project.memory.some((x) => x.file === f) && onSelect({ project: project.id, view: "memory", file: f });
  const extra = Object.entries(fm).filter(([k]) => !SHOWN.has(k));

  const noteAudit = ctx.audit.state === "ready" ? (ctx.audit.data.notes.find((n) => n.file === file) ?? null) : null;

  return (
    <div className="grid gap-5 p-5 2xl:grid-cols-[minmax(0,1fr)_440px] xl:grid-cols-[minmax(0,1fr)_380px]">
    <article className="min-w-0 space-y-5">
      <header className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
              <FileText aria-hidden className="size-3.5" />
              {isIndex ? "Memory index · loaded at the start of every session" : "Memory note"}
            </p>
            <h2 className="mt-1 text-lg font-semibold">{isIndex ? "MEMORY.md" : (fm.name ?? file)}</h2>
          </div>
          <button
            type="button"
            onClick={() => setRaw((r) => !r)}
            aria-pressed={raw}
            className={cx(
              "flex min-h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors duration-150",
              raw ? "border-info/50 bg-info/10 text-info" : "border-line text-fg-muted hover:text-fg",
            )}
          >
            <Code aria-hidden className="size-3.5" /> {raw ? "Showing raw file" : "Show raw file"}
          </button>
        </div>
        {fm.description && <p className="max-w-3xl text-sm leading-6 text-fg-muted">{fm.description}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {fm.type && <Pill label={fm.type} className={TYPE_STYLE[fm.type] ?? "bg-muted text-fg-muted"} />}
          {!isIndex && summary && !summary.inIndex && (
            <Pill icon={TriangleAlert} label="Not listed in MEMORY.md" className="bg-warn/10 text-warn" />
          )}
        </div>
      </header>

      {!isIndex && (
        <dl className="grid gap-x-6 gap-y-2 rounded-lg border border-line bg-card p-3 text-xs sm:grid-cols-[auto_1fr]">
          <dt className="text-fg-subtle">Written in</dt>
          <dd>
            {origin ? (
              <button
                type="button"
                onClick={() => onSelect({ project: project.id, view: "session", id: origin.id })}
                className="inline-flex cursor-pointer items-center gap-1.5 text-info underline-offset-2 hover:underline"
              >
                <MessagesSquare aria-hidden className="size-3.5" />
                {origin.title} · {fmtDate(origin.startedAt)}
              </button>
            ) : fm.originSessionId ? (
              <span className="text-warn">
                A session that is no longer on disk <span className="font-mono text-fg-subtle">({fm.originSessionId.slice(0, 8)})</span>
              </span>
            ) : (
              <span className="text-fg-muted">Not recorded</span>
            )}
          </dd>
          <dt className="text-fg-subtle">Last changed</dt>
          <dd className="text-fg-muted">{fmtDate(fm.modified ?? m.updatedAt)}</dd>
          {extra.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-fg-subtle">{k}</dt>
              <dd className="break-all font-mono text-fg-muted">{v}</dd>
            </div>
          ))}
          <dt className="text-fg-subtle">File</dt>
          <dd className="break-all font-mono text-fg-muted">{shortHome(m.absolutePath)}</dd>
        </dl>
      )}

      <div className="rounded-lg border border-line bg-card p-4">
        {raw ? (
          <pre className="scroll-thin overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-5 text-fg-muted">{m.raw}</pre>
        ) : m.body.trim() ? (
          <Markdown onNoteLink={openNote} resolveWiki={(n) => byName.get(n) ?? null}>
            {m.body}
          </Markdown>
        ) : (
          <p className="text-sm text-fg-muted">This note is empty.</p>
        )}
      </div>
    </article>
      <aside aria-label="Inspector" className="min-w-0">
        <Inspector
          projectId={project.id}
          note={m}
          audit={noteAudit}
          auditing={ctx.audit.state === "loading"}
          onChanged={ctx.changed}
          onEvidence={ctx.openEvidence}
        />
      </aside>
    </div>
  );
}
