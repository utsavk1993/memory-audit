import { Explorer } from "./explorer/Explorer";
import { Logo } from "./Logo";

export function Dashboard() {
  return (
    <div className="flex min-h-dvh w-full flex-col gap-3 p-3 lg:h-dvh">
      <header className="flex items-center gap-3">
        <Logo className="size-9 shrink-0" />
        <div>
          <h1 className="text-base font-semibold leading-5 tracking-tight">Memory Audit</h1>
          <p className="text-xs text-fg-muted">Catch the notes your AI agent shouldn&rsquo;t trust.</p>
        </div>
      </header>
      <Explorer />
    </div>
  );
}
