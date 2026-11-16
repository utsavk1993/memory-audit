"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import { cx } from "../ui";

// Panel widths are a per-browser convenience, kept in localStorage. Storage can be missing or blocked,
// so every access is guarded and the default width is used instead.
const EVENT = "memory-audit:width";

function read(key: string, fallback: number) {
  try {
    const n = Number(localStorage.getItem(key));
    return Number.isFinite(n) && n > 0 ? n : fallback;
  } catch {
    return fallback;
  }
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** A panel width that survives reloads and navigation. */
export function usePanelWidth(key: string, fallback: number, min: number, max: number) {
  const width = useSyncExternalStore(
    subscribe,
    () => Math.min(max, Math.max(min, read(key, fallback))),
    () => fallback,
  );
  const setWidth = useCallback(
    (w: number) => {
      try {
        localStorage.setItem(key, String(Math.round(Math.min(max, Math.max(min, w)))));
      } catch {
        /* storage blocked: the width just won't stick */
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [key, min, max],
  );
  return { width, setWidth, reset: () => setWidth(fallback), min, max };
}

/**
 * A drag handle on one edge of a panel. `edge` is the side of the panel it sits on:
 * "right" grows the panel when dragged right (left sidebar), "left" grows it when dragged left (right panel).
 * Arrow keys resize too; double-click resets.
 */
export function ResizeHandle({
  label,
  edge,
  panel,
  className,
}: {
  label: string;
  edge: "left" | "right";
  panel: ReturnType<typeof usePanelWidth>;
  className?: string;
}) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const dir = edge === "right" ? 1 : -1;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={panel.width}
      aria-valuemin={panel.min}
      aria-valuemax={panel.max}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: panel.width };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(e) => {
        if (start.current) panel.setWidth(start.current.w + dir * (e.clientX - start.current.x));
      }}
      onPointerUp={() => {
        start.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }}
      onLostPointerCapture={() => {
        start.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }}
      onDoubleClick={panel.reset}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16;
        if (e.key === "ArrowLeft") panel.setWidth(panel.width - dir * step);
        else if (e.key === "ArrowRight") panel.setWidth(panel.width + dir * step);
        else return;
        e.preventDefault();
      }}
      className={cx(
        "group absolute top-0 z-10 hidden h-full w-3 cursor-col-resize touch-none justify-center focus-visible:outline-none",
        edge === "right" ? "-right-3" : "-left-3",
        className,
      )}
    >
      {/* Full-height line on hover/drag, plus an always-visible grip so the handle can be found.
          The grip starts at the top of the handle and sticks to the middle of the visible area, so it follows
          the scroll. (Centring it with my-auto put it halfway down a tall panel, off-screen until you scrolled there.)
          A sticky box's % inset is relative to the scroll area, and 1.25rem is half the grip's height. */}
      <span className="absolute inset-y-0 w-0.5 rounded-full bg-transparent transition-colors duration-150 group-hover:bg-info/50 group-focus-visible:bg-info group-active:bg-info" />
      <span className="sticky top-[calc(50%-1.25rem)] flex self-start h-10 w-1.5 flex-col items-center justify-center gap-1 rounded-full bg-line-strong transition-colors duration-150 group-hover:bg-info group-active:bg-info">
        <span className="size-0.5 rounded-full bg-bg" />
        <span className="size-0.5 rounded-full bg-bg" />
        <span className="size-0.5 rounded-full bg-bg" />
      </span>
    </div>
  );
}
