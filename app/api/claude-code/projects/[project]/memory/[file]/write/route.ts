import { writeNote } from "@/lib/audit/writer";
import { BadRequestError } from "@/lib/claude-code/reader";
import { guardedJson, respond } from "@/lib/claude-code/respond";

export async function POST(req: Request, ctx: RouteContext<"/api/claude-code/projects/[project]/memory/[file]/write">) {
  const { project, file } = await ctx.params;
  return respond(async () => {
    const b = await guardedJson<{ raw: string; expectedSha: string; reason?: string }>(req);
    if (typeof b.raw !== "string" || typeof b.expectedSha !== "string") throw new BadRequestError("raw and expectedSha are required");
    return writeNote(project, file, b.raw, b.expectedSha, (b.reason ?? "Edited in Memory Audit").slice(0, 200));
  });
}
