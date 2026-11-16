import { listBackups, readBackup, restoreBackup } from "@/lib/audit/writer";
import { BadRequestError } from "@/lib/claude-code/reader";
import { guardedJson, respond } from "@/lib/claude-code/respond";

type Ctx = RouteContext<"/api/claude-code/projects/[project]/memory/[file]/backups">;

export async function GET(req: Request, ctx: Ctx) {
  const { project, file } = await ctx.params;
  const id = new URL(req.url).searchParams.get("id");
  return respond(async () => (id ? { id, raw: await readBackup(project, file, id) } : listBackups(project, file)));
}

export async function POST(req: Request, ctx: Ctx) {
  const { project, file } = await ctx.params;
  return respond(async () => {
    const { id } = await guardedJson<{ id: string }>(req);
    if (typeof id !== "string") throw new BadRequestError("id is required");
    return restoreBackup(project, file, id);
  });
}
