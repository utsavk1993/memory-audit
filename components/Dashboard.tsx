import { isDemo } from "@/lib/demo";
import { Explorer } from "./explorer/Explorer";
import { Logo } from "./Logo";

const REPO = "https://github.com/utsavk1993/memory-audit";

export function Dashboard() {
  return (
    <div className="flex min-h-dvh w-full flex-col gap-3 p-3 lg:h-dvh">
      <header className="flex flex-wrap items-center gap-3">
        <Logo className="size-9 shrink-0" />
        <div>
          <h1 className="text-base font-semibold leading-5 tracking-tight">Memory Audit</h1>
          <p className="text-xs text-fg-muted">Catch the notes your AI agent shouldn&rsquo;t trust.</p>
        </div>
        {isDemo() && (
          <p className="w-full rounded-lg border border-guess/30 bg-guess/10 px-3 py-2 text-xs leading-5 text-fg-muted sm:ml-auto sm:w-auto">
            <b className="font-medium text-fg">Live demo</b> with a made-up project. Read-only, and the AI check replays
            a saved answer.{" "}
            <a href={REPO} className="font-medium text-guess underline underline-offset-2">
              Install it
            </a>{" "}
            to audit your own notes locally.
          </p>
        )}
      </header>
      <Explorer />
    </div>
  );
}
