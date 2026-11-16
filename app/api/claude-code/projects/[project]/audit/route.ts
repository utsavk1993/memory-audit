import { auditProject } from "@/lib/audit/checks";
import { respond } from "@/lib/claude-code/respond";

export async function GET(_req: Request, ctx: RouteContext<"/api/claude-code/projects/[project]/audit">) {
  const { project } = await ctx.params;
  return respond(() => auditProject(project));
}
