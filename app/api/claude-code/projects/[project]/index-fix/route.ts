import { addToIndex, removeBrokenLinks } from "@/lib/audit/writer";
import { BadRequestError } from "@/lib/claude-code/reader";
import { guardedJson, respond } from "@/lib/claude-code/respond";

type Body = { action: "add-to-index"; file: string } | { action: "remove-broken-links" };

export async function POST(req: Request, ctx: RouteContext<"/api/claude-code/projects/[project]/index-fix">) {
  const { project } = await ctx.params;
  return respond(async () => {
    const body = await guardedJson<Body>(req);
    if (body.action === "add-to-index") return addToIndex(project, body.file);
    if (body.action === "remove-broken-links") return removeBrokenLinks(project);
    throw new BadRequestError("Unknown action");
  });
}
