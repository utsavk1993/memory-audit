"use client";

import { CircleCheck, CircleHelp, CircleX, Clock, Info, MessagesSquare, TriangleAlert, User, Bot, FilePen, type LucideIcon } from "lucide-react";
import type { AiVerdict, Evidence, Finding, Severity } from "@/lib/audit/types";
import { cx } from "../ui";
import { fmtDate } from "./format";

export const SEV: Record<Severity, { label: string; icon: LucideIcon; text: string; bg: string; border: string }> = {
  ok: { label: "Looks fine", icon: CircleCheck, text: "text-ok", bg: "bg-ok/10", border: "border-ok/30" },
  info: { label: "Minor", icon: Info, text: "text-info", bg: "bg-info/10", border: "border-info/30" },
  warn: { label: "Check this", icon: TriangleAlert, text: "text-warn", bg: "bg-warn/10", border: "border-warn/40" },
  bad: { label: "Problem", icon: CircleX, text: "text-bad", bg: "bg-bad/10", border: "border-bad/40" },
};

export const VERDICT: Record<AiVerdict, { label: string; icon: LucideIcon; text: string; bg: string; border: string }> = {
  supported: { label: "Supported", icon: CircleCheck, text: "text-ok", bg: "bg-ok/10", border: "border-ok/30" },
  outdated: { label: "Out of date", icon: Clock, text: "text-warn", bg: "bg-warn/10", border: "border-warn/40" },
  contradicted: { label: "Wrong", icon: CircleX, text: "text-bad", bg: "bg-bad/10", border: "border-bad/40" },
  unverified: { label: "Unverified", icon: CircleHelp, text: "text-guess", bg: "bg-guess/10", border: "border-guess/40" },
};

export function Badge({ s, small }: { s: Severity; small?: boolean }) {
  const v = SEV[s];
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1 rounded-full font-medium", v.bg, v.text, small ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-[11px]")}>
      <v.icon aria-hidden className={small ? "size-3" : "size-3.5"} /> {v.label}
    </span>
  );
}

export function VerdictBadge({ v }: { v: AiVerdict }) {
  const s = VERDICT[v];
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", s.bg, s.text)}>
      <s.icon aria-hidden className="size-3.5" /> {s.label}
    </span>
  );
}

export function Dot({ s }: { s: Severity }) {
  const cls = { ok: "bg-ok", info: "bg-info", warn: "bg-warn", bad: "bg-bad" }[s];
  return <span aria-label={SEV[s].label} title={SEV[s].label} className={cx("inline-block size-2 shrink-0 rounded-full", cls)} />;
}

const WHO: Record<Evidence["who"], { label: string; icon: LucideIcon }> = {
  user: { label: "You", icon: User },
  assistant: { label: "Claude", icon: Bot },
  memory_write: { label: "Note written", icon: FilePen },
  tool: { label: "Tool", icon: MessagesSquare },
};

export function EvidenceList({
  evidence,
  onOpen,
}: {
  evidence: Evidence[];
  onOpen: (sessionId: string, line: number) => void;
}) {
  if (!evidence.length) return null;
  return (
    <ul className="mt-2 space-y-1.5">
      {evidence.map((e) => {
        const w = WHO[e.who];
        return (
          <li key={`${e.sessionId}:${e.line}`}>
            <button
              type="button"
              onClick={() => onOpen(e.sessionId, e.line)}
              className="w-full cursor-pointer rounded-md border border-line bg-bg px-2.5 py-1.5 text-left transition-colors duration-150 hover:border-line-strong"
            >
              <span className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
                <w.icon aria-hidden className="size-3" /> {w.label} · {e.sessionTitle.slice(0, 48)} · {fmtDate(e.at)} ·{" "}
                <span className="text-info">line {e.line}</span>
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-fg-muted">{e.quote}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function FindingRow({
  f,
  onEvidence,
  fixLabel,
  onFix,
  busy,
}: {
  f: Finding;
  onEvidence: (sessionId: string, line: number) => void;
  fixLabel?: string;
  onFix?: () => void;
  busy?: boolean;
}) {
  const v = SEV[f.severity];
  return (
    <li className={cx("rounded-lg border p-3", v.border, f.severity === "ok" ? "bg-card" : v.bg)}>
      <div className="flex items-start gap-2">
        <v.icon aria-hidden className={cx("mt-0.5 size-4 shrink-0", v.text)} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-5">{f.title}</p>
          {f.detail && <p className="mt-0.5 whitespace-pre-wrap break-words text-xs leading-5 text-fg-muted">{f.detail}</p>}
          {f.evidence && <EvidenceList evidence={f.evidence} onOpen={onEvidence} />}
          {onFix && fixLabel && (
            <button
              type="button"
              disabled={busy}
              onClick={onFix}
              className="mt-2 min-h-8 cursor-pointer rounded-md bg-info/15 px-2.5 text-xs font-medium text-info transition-colors duration-150 hover:bg-info/25 disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? "Working…" : fixLabel}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
