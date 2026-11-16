"use client";

import {
  Bot,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CornerDownRight,
  FilePen,
  Info,
  Loader2,
  Search,
  SquareTerminal,
  TriangleAlert,
  User,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectDetail, SessionDetail, SessionEvent } from "@/lib/claude-code/types";
import { useJson } from "@/lib/claude-code/useJson";
import { Markdown } from "../Markdown";
import { Pill, cx } from "../ui";
import { fmtDate, shortHome } from "./format";
import type { Selection } from "./Explorer";

const PAGE = 300;

export function SessionView({
  project,
  id,
  line,
  reloadKey,
  onSelect,
}: {
  project: ProjectDetail;
  id: string;
  line?: number;
  reloadKey: number;
  onSelect: (s: Selection) => void;
}) {
  const [tools, setTools] = useState(false);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const focusRef = useRef<HTMLLIElement | null>(null);
  const res = useJson<SessionDetail>(
    `/api/claude-code/projects/${encodeURIComponent(project.id)}/sessions/${encodeURIComponent(id)}`,
    reloadKey,
  );

  const events = useMemo(() => {
    if (res.state !== "ready") return [];
    const needle = q.trim().toLowerCase();
    return res.data.events.filter(
      (e) =>
        (tools || e.index === line || e.kind === "user" || e.kind === "assistant" || e.kind === "memory_write") &&
        (!needle || e.text.toLowerCase().includes(needle)),
    );
  }, [res, tools, q, line]);

  // When opened from evidence, show enough rows to include that line and scroll to it.
  const focusPos = line ? events.findIndex((e) => e.index === line) : -1;
  const shown = Math.max(limit, focusPos + 20);
  useEffect(() => {
    if (focusPos >= 0) focusRef.current?.scrollIntoView({ block: "center" });
  }, [focusPos]);

  if (res.state === "loading" || res.state === "idle")
    return (
      <p className="flex items-center gap-2 p-5 text-sm text-fg-muted">
        <Loader2 aria-hidden className="size-4 animate-spin" /> Reading session log…
      </p>
    );
  if (res.state === "error")
    return (
      <p className="flex items-center gap-2 p-5 text-sm text-bad">
        <TriangleAlert aria-hidden className="size-4" /> {res.error}
      </p>
    );

  const s = res.data;
  const writes = s.events.filter((e) => e.kind === "memory_write");
  const openNote = (f: string) =>
    project.memory.some((m) => m.file === f) && onSelect({ project: project.id, view: "memory", file: f });

  return (
    <div className="flex min-h-full flex-col">
      <header className="space-y-3 border-b border-line p-5">
        <div>
          <p className="text-xs text-fg-subtle">Session log</p>
          <h2 className="mt-1 text-lg font-semibold">{s.title}</h2>
          <p className="mt-1 text-xs text-fg-muted">
            {fmtDate(s.startedAt)} → {fmtDate(s.endedAt)} · {s.lineCount} lines in the file, {s.skippedLines} are
            bookkeeping and hidden
          </p>
          <p className="mt-0.5 break-all font-mono text-[11px] text-fg-subtle">{shortHome(s.absolutePath)}</p>
          {line && (
            <p className="mt-2 text-xs text-info">Showing evidence at line {line}, highlighted below.</p>
          )}
        </div>
        {writes.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-fg-muted">Memory notes written in this session:</span>
            {writes.map((w) => (
              <button
                key={`${w.index}-${w.memoryFile}`}
                type="button"
                onClick={() => w.memoryFile && openNote(w.memoryFile)}
                className="cursor-pointer rounded-md bg-warn/10 px-2 py-0.5 font-mono text-warn transition-colors duration-150 hover:bg-warn/20"
              >
                {w.memoryFile}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-w-60 flex-1 items-center gap-2 rounded-lg border border-line bg-card px-2.5 transition-colors duration-150 focus-within:border-line-strong">
            <Search aria-hidden className="size-3.5 text-fg-subtle" />
            <span className="sr-only">Search this session</span>
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setLimit(PAGE);
              }}
              placeholder="Search this session"
              className="min-h-8 w-full bg-transparent text-[13px] outline-none focus-visible:outline-none placeholder:text-fg-subtle"
            />
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={tools}
              onChange={(e) => {
                setTools(e.target.checked);
                setLimit(PAGE);
              }}
              className="size-3.5 cursor-pointer accent-info"
            />
            Show tool calls and results
          </label>
          <span className="text-xs text-fg-subtle">{events.length} shown</span>
        </div>
      </header>

      <ol className="flex-1 space-y-2 p-5">
        {events.length === 0 && <p className="text-sm text-fg-muted">Nothing matches.</p>}
        {events.slice(0, shown).map((e, i) => (
          <li
            key={`${e.index}-${i}`}
            ref={e.index === line && events.findIndex((x) => x.index === line) === i ? focusRef : undefined}
            className={cx(e.index === line && "rounded-lg ring-2 ring-info ring-offset-2 ring-offset-panel")}
          >
            <EventRow e={e} onNote={openNote} />
          </li>
        ))}
        {events.length > shown && (
          <li>
            <button
              type="button"
              onClick={() => setLimit(shown + PAGE)}
              className="min-h-9 w-full cursor-pointer rounded-lg border border-line text-[13px] text-fg-muted transition-colors duration-150 hover:border-line-strong hover:text-fg"
            >
              Show {Math.min(PAGE, events.length - shown)} more ({events.length - shown} left)
            </button>
          </li>
        )}
      </ol>
    </div>
  );
}

function EventRow({ e, onNote }: { e: SessionEvent; onNote: (f: string) => void }) {
  const time = e.at ? new Date(e.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";
  const meta = (
    <span className="ml-auto shrink-0 font-mono text-[10px] text-fg-subtle" title={`Line ${e.index} of the .jsonl file`}>
      {time} · line {e.index}
    </span>
  );

  if (e.kind === "user")
    return (
      <div className="rounded-lg border border-info/25 bg-info/8 p-3">
        <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-info">
          <User aria-hidden className="size-3.5" /> You {meta}
        </p>
        <p className="whitespace-pre-wrap text-sm leading-6">{e.text}</p>
        {e.truncated && <Clipped />}
      </div>
    );

  if (e.kind === "assistant")
    return (
      <div className="rounded-lg border border-line bg-card p-3">
        <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
          <Bot aria-hidden className="size-3.5" /> Claude {meta}
        </p>
        <Markdown>{e.text}</Markdown>
        {e.truncated && <Clipped />}
      </div>
    );

  if (e.kind === "memory_write")
    return (
      <div className="rounded-lg border border-warn/40 bg-warn/8 p-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-warn">
          <FilePen aria-hidden className="size-3.5" /> Claude wrote a memory note {meta}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => e.memoryFile && onNote(e.memoryFile)}
            className="cursor-pointer font-mono text-info underline-offset-2 hover:underline"
          >
            {e.memoryFile}
          </button>
          <Pill label={e.tool ?? "Write"} className="bg-muted text-fg-muted" />
        </p>
      </div>
    );

  if (e.kind === "tool_use")
    return (
      <div className="flex gap-2 rounded-lg px-3 py-1.5 text-xs text-fg-muted">
        <SquareTerminal aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2">
            <span className="font-semibold text-fg">{e.tool}</span> {meta}
          </p>
          <p className="mt-0.5 whitespace-pre-wrap break-all font-mono text-[11px] leading-5">{e.text}</p>
        </div>
      </div>
    );

  if (e.kind === "tool_result") return <ToolResult e={e} meta={meta} />;

  return (
    <p className="flex items-center gap-2 px-3 text-[11px] text-fg-subtle">
      <Info aria-hidden className="size-3" /> Context added: {e.text} {meta}
    </p>
  );
}

function ToolResult({ e, meta }: { e: SessionEvent; meta: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const lines = e.text.split("\n");
  const long = lines.length > 4 || e.text.length > 400;
  const shown = open || !long ? e.text : lines.slice(0, 4).join("\n").slice(0, 400);
  return (
    <div className={cx("ml-5 rounded-lg border px-3 py-2 text-xs", e.isError ? "border-bad/40 bg-bad/8" : "border-line bg-bg")}>
      <p className={cx("flex items-center gap-1.5 font-medium", e.isError ? "text-bad" : "text-fg-subtle")}>
        {e.isError ? <CircleAlert aria-hidden className="size-3.5" /> : <CornerDownRight aria-hidden className="size-3.5" />}
        {e.isError ? "Tool error" : "Tool result"} {meta}
      </p>
      <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-fg-muted">{shown || "(empty)"}</pre>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-1 flex cursor-pointer items-center gap-1 text-[11px] text-info"
        >
          {open ? <ChevronDown aria-hidden className="size-3" /> : <ChevronRight aria-hidden className="size-3" />}
          {open ? "Show less" : `Show all ${lines.length} lines`}
        </button>
      )}
      {e.truncated && open && <Clipped />}
    </div>
  );
}

function Clipped() {
  return <p className="mt-1 text-[11px] text-fg-subtle">Long content shortened for display.</p>;
}
