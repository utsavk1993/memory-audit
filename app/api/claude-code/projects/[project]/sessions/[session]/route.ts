import { readSession } from "@/lib/claude-code/reader";
import { respond } from "@/lib/claude-code/respond";

export async function GET(_req: Request, ctx: RouteContext<"/api/claude-code/projects/[project]/sessions/[session]">) {
  const { project, session } = await ctx.params;
  return respond(() => readSession(project, session));
}
