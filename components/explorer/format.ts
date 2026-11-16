export function fmtDate(iso: string | null | undefined, withTime = true): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function shortHome(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
}

export const TYPE_STYLE: Record<string, string> = {
  user: "bg-info/10 text-info",
  feedback: "bg-guess/10 text-guess",
  project: "bg-ok/10 text-ok",
  reference: "bg-warn/10 text-warn",
};
