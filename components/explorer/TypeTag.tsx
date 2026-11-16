import { cx } from "../ui";
import { TYPE_STYLE } from "./format";

/** Plain-language meaning of each memory type, as Claude Code uses them. */
export const TYPE_INFO: Record<string, { title: string; text: string }> = {
  user: {
    title: "About you",
    text: "Your role, skills and preferences. Shapes how Claude talks to you and explains things.",
  },
  feedback: {
    title: "How you want Claude to work",
    text: "A correction you gave, or an approach you approved, with the reason. Claude follows it in every session, so a wrong one does the most damage.",
  },
  project: {
    title: "About the work",
    text: "Goals, decisions, deadlines or limits that the code and git history don't show. These go out of date fastest.",
  },
  reference: {
    title: "Where to look",
    text: "A pointer to something outside the code, like a dashboard, ticket or doc.",
  },
};

/**
 * The note's type with a hover/focus explanation.
 * Inside a button (a list row) it must not be focusable itself, so pass `focusable={false}` there.
 */
export function TypeTag({ type, align = "left", focusable = true }: { type: string; align?: "left" | "right"; focusable?: boolean }) {
  const info = TYPE_INFO[type];
  return (
    <span className="group/tag relative inline-flex" tabIndex={focusable && info ? 0 : undefined}>
      <span
        className={cx(
          "inline-flex shrink-0 cursor-help items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium leading-4",
          TYPE_STYLE[type] ?? "bg-muted text-fg-muted",
        )}
      >
        {type}
      </span>
      {info && (
        <span
          role="tooltip"
          className={cx(
            "pointer-events-none invisible absolute top-full z-30 mt-1.5 w-64 rounded-lg border border-line-strong bg-panel p-2.5 text-left text-xs font-normal leading-5 text-fg-muted opacity-0 shadow-xl transition-opacity duration-150",
            "group-hover/tag:visible group-hover/tag:opacity-100 group-focus-visible/tag:visible group-focus-visible/tag:opacity-100",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          <b className="block text-fg">{info.title}</b>
          {info.text}
        </span>
      )}
    </span>
  );
}
