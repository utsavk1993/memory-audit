import type { LucideIcon } from "lucide-react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Pill({ icon: Icon, label, className }: { icon?: LucideIcon; label: string; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium leading-4",
        className,
      )}
    >
      {Icon && <Icon aria-hidden className="size-3" />}
      {label}
    </span>
  );
}
