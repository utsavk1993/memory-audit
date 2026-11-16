import { readMemory } from "@/lib/claude-code/reader";
import { respond } from "@/lib/claude-code/respond";

export async function GET(_req: Request, ctx: RouteContext<"/api/claude-code/projects/[project]/memory/[file]">) {
  const { project, file } = await ctx.params;
  return respond(() => readMemory(project, file));
}
