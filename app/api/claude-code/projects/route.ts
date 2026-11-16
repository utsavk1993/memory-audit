import { listProjects } from "@/lib/claude-code/reader";
import { respond } from "@/lib/claude-code/respond";

export async function GET() {
  return respond(() => listProjects());
}
