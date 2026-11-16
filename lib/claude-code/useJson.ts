"use client";

import { useEffect, useState } from "react";

export type Loadable<T> =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "error"; error: string }
  | { state: "ready"; data: T };

/** Fetch JSON from the local API. Pass null to skip. Refetches when `reloadKey` changes. */
export function useJson<T>(url: string | null, reloadKey = 0): Loadable<T> {
  const [res, setRes] = useState<{ url: string | null; key: number; value: Loadable<T> }>({
    url: null,
    key: 0,
    value: { state: "idle" },
  });

  useEffect(() => {
    if (!url) return;
    const ctrl = new AbortController();
    fetch(url, { signal: ctrl.signal, cache: "no-store" })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body?.error ?? `Request failed (${r.status})`);
        setRes({ url, key: reloadKey, value: { state: "ready", data: body as T } });
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") setRes({ url, key: reloadKey, value: { state: "error", error: e.message } });
      });
    return () => ctrl.abort();
  }, [url, reloadKey]);

  if (!url) return { state: "idle" };
  if (res.url !== url || res.key !== reloadKey) return { state: "loading" };
  return res.value;
}
