"use client";

import {
  ChevronDown,
  ChevronRight,
  FileText,
  FolderClosed,
  ListTree,
  Loader2,
  MessagesSquare,
  RefreshCw,
  Search,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import type { ProjectAudit, Severity } from "@/lib/audit/types";
import type { ProjectDetail, ProjectSummary } from "@/lib/claude-code/types";
import { Dot } from "./audit-ui";
import type { Loadable } from "@/lib/claude-code/useJson";
import { cx } from "../ui";
import { fmtDate, shortHome } from "./format";
import type { Selection } from "./Explorer";

export function Sidebar({
  projects,
  detail,
  audit,
  sel,
  onSelect,
  onRefresh,
}: {
  projects: Loadable<ProjectSummary[]>;
  detail: Loadable<ProjectDetail>;
  audit: ProjectAudit | null;
  sel: Selection | null;
  onSelect: (s: Selection | null) => void;
  onRefresh: () => void;
}) {
  const [q, setQ] = useState("");
  // Only projects that have memory notes: they're the only ones there is anything to audit in.
  const list =
    projects.state === "ready"
      ? projects.data.filter(
          (p) =>
            p.memoryCount > 0 &&
            (!q || `${p.name} ${p.path}`.toLowerCase().includes(q.toLowerCase())),
        )
      : [];

  return (
    <aside className="flex min-h-0 flex-col rounded-xl border border-line bg-panel">
      <div className="space-y-2 border-b border-line p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">Projects with memory</p>
          <button
            type="button"
            onClick={onRefresh}
            aria-label="Reload from disk"
            title="Reload from disk"
            className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-fg-muted transition-colors duration-150 hover:bg-muted hover:text-fg"
          >
            <RefreshCw aria-hidden className="size-4" />
          </button>
        </div>
        <label className="flex items-center gap-2 rounded-lg border border-line bg-card px-2.5 transition-colors duration-150 focus-within:border-line-strong">
          <Search aria-hidden className="size-3.5 text-fg-subtle" />
          <span className="sr-only">Filter projects</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter projects"
            className="min-h-8 w-full bg-transparent text-[13px] outline-none focus-visible:outline-none placeholder:text-fg-subtle"
          />
        </label>
      </div>

      <nav aria-label="Projects" className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2">
        {projects.state === "loading" && <Status icon={Loader2} spin text="Reading projects…" />}
        {projects.state === "error" && <Status icon={TriangleAlert} text={projects.error} bad />}
        {projects.state === "ready" && list.length === 0 && <Status icon={FolderClosed} text="No matching projects" />}
        <ul className="space-y-0.5">
          {list.map((p) => {
            const open = sel?.project === p.id;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => onSelect(open ? null : { project: p.id, view: "overview" })}
                  className={cx(
                    "flex w-full cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors duration-150",
                    open ? "bg-card" : "hover:bg-card/60",
                  )}
                >
                  {open ? (
                    <ChevronDown aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                  ) : (
                    <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium">{p.name}</span>
                      <span className="shrink-0 text-[11px] text-fg-subtle">{fmtDate(p.updatedAt, false)}</span>
                    </span>
                    <span className="block truncate font-mono text-[11px] text-fg-subtle">{shortHome(p.path)}</span>
                    <span className="mt-1 flex gap-3 text-[11px] text-fg-muted">
                      <span className={cx(p.memoryCount > 0 && "text-fg")}>
                        {p.memoryCount} note{p.memoryCount === 1 ? "" : "s"}
                      </span>
                      <span>
                        {p.sessionCount} session{p.sessionCount === 1 ? "" : "s"}
                      </span>
                    </span>
                  </span>
                </button>
                {open && <ProjectTree detail={detail} audit={audit} sel={sel} onSelect={onSelect} />}
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

function ProjectTree({
  detail,
  audit,
  sel,
  onSelect,
}: {
  detail: Loadable<ProjectDetail>;
  audit: ProjectAudit | null;
  sel: Selection | null;
  onSelect: (s: Selection) => void;
}) {
  if (detail.state === "loading") return <Status icon={Loader2} spin text="Loading…" indent />;
  if (detail.state === "error") return <Status icon={TriangleAlert} text={detail.error} bad indent />;
  if (detail.state !== "ready") return null;
  const d = detail.data;
  const notes = d.memory;
  const status = new Map(audit?.projectId === d.id ? audit.notes.map((n) => [n.file, n.status]) : []);

  return (
    <div className="mb-2 ml-4 border-l border-line pl-2">
      <Item
        icon={ListTree}
        label="Overview"
        active={sel?.view === "overview"}
        onClick={() => onSelect({ project: d.id, view: "overview" })}
      />

      <Heading text={`Memory · ${d.memoryCount} note${d.memoryCount === 1 ? "" : "s"}`} />
      {notes.length === 0 ? (
        <p className="px-2 py-1 text-[11px] text-fg-subtle">No memory folder</p>
      ) : (
        notes.map((m) => (
          <Item
            key={m.file}
            icon={FileText}
            label={m.isIndex ? "MEMORY.md" : (m.name ?? m.file.replace(/\.md$/, ""))}
            hint={m.isIndex ? "index" : m.type ?? undefined}
            status={status.get(m.file)}
            active={sel?.view === "memory" && sel.file === m.file}
            onClick={() => onSelect({ project: d.id, view: "memory", file: m.file })}
          />
        ))
      )}

      <Heading text={`Sessions · ${d.sessions.length}`} />
      {d.sessions.map((s) => (
        <Item
          key={s.id}
          icon={MessagesSquare}
          label={s.title}
          hint={fmtDate(s.updatedAt, false)}
          active={sel?.view === "session" && sel.id === s.id}
          onClick={() => onSelect({ project: d.id, view: "session", id: s.id })}
        />
      ))}
    </div>
  );
}

function Heading({ text }: { text: string }) {
  return <p className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{text}</p>;
}

function Item({
  icon: Icon,
  label,
  hint,
  status,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  hint?: string;
  status?: Severity;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={label}
      className={cx(
        "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-150",
        active ? "bg-info/15 text-fg" : "text-fg-muted hover:bg-card hover:text-fg",
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {status && <Dot s={status} />}
      {hint && <span className="shrink-0 text-[11px] text-fg-subtle">{hint}</span>}
    </button>
  );
}

function Status({
  icon: Icon,
  text,
  spin,
  bad,
  indent,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  text: string;
  spin?: boolean;
  bad?: boolean;
  indent?: boolean;
}) {
  return (
    <p className={cx("flex items-center gap-2 px-2 py-2 text-xs", bad ? "text-bad" : "text-fg-muted", indent && "ml-6")}>
      <Icon aria-hidden className={cx("size-3.5", spin && "animate-spin")} />
      {text}
    </p>
  );
}
