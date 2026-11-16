import { getProject } from "@/lib/claude-code/reader";
import { respond } from "@/lib/claude-code/respond";

export async function GET(_req: Request, ctx: RouteContext<"/api/claude-code/projects/[project]">) {
  const { project } = await ctx.params;
  return respond(() => getProject(project));
}
