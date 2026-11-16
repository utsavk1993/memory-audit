import { connection } from "@/lib/audit/ai";
import { respond } from "@/lib/claude-code/respond";

/** Whether the AI check can run, and which account it would use. Sends nothing off the machine. */
export async function GET() {
  return respond(() => connection());
}
