import { estimate, lastResult, verify } from "@/lib/audit/ai";
import { BadRequestError } from "@/lib/claude-code/reader";
import { guardedJson, respond } from "@/lib/claude-code/respond";

type Ctx = RouteContext<"/api/claude-code/projects/[project]/memory/[file]/ai">;

/** The last AI result for this note, if any (free). */
export async function GET(_req: Request, ctx: Ctx) {
  const { project, file } = await ctx.params;
  return respond(async () => ({ result: await lastResult(project, file) }));
}

/** action "estimate" counts tokens (free); action "run" calls Claude (costs money). */
export async function POST(req: Request, ctx: Ctx) {
  const { project, file } = await ctx.params;
  return respond(async () => {
    const { action } = await guardedJson<{ action: "estimate" | "run" }>(req);
    if (action === "estimate") return estimate(project, file);
    if (action === "run") return verify(project, file);
    throw new BadRequestError("Unknown action");
  });
}
