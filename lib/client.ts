"use client";

/** POST to the app's own API. The custom header is required by the server for anything that writes or costs money. */
export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-memory-audit": "1" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error ?? `Request failed (${r.status})`);
  return data as T;
}

export async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error ?? `Request failed (${r.status})`);
  return data as T;
}

export const api = {
  project: (p: string) => `/api/claude-code/projects/${encodeURIComponent(p)}`,
  note: (p: string, f: string) => `/api/claude-code/projects/${encodeURIComponent(p)}/memory/${encodeURIComponent(f)}`,
};
