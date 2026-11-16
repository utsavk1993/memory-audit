import { connection } from "next/server";
import { AiError } from "../audit/ai";
import { ConflictError } from "../audit/writer";
import { BadRequestError, NotFoundError } from "./reader";

/** Run a handler at request time and map known errors to HTTP status codes. */
export async function respond<T>(fn: () => Promise<T>): Promise<Response> {
  await connection(); // never prerender: these read the user's disk
  try {
    return Response.json(await fn(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof NotFoundError) return Response.json({ error: e.message }, { status: 404 });
    if (e instanceof BadRequestError) return Response.json({ error: e.message }, { status: 400 });
    if (e instanceof ConflictError) return Response.json({ error: e.message }, { status: 409 });
    if (e instanceof AiError) return Response.json({ error: e.message }, { status: 502 });
    if (e instanceof ForbiddenError) return Response.json({ error: e.message }, { status: 403 });
    console.error("[memory-audit]", e);
    return Response.json({ error: "Something went wrong on the local server" }, { status: 500 });
  }
}

export class ForbiddenError extends Error {}

const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

/**
 * Only the app's own page may call endpoints that write files or spend money.
 * - Host must be local (blocks DNS-rebinding).
 * - Origin must equal the host (blocks other websites).
 * - A custom header forces a CORS preflight, which this server never approves.
 */
export async function guardedJson<T>(req: Request): Promise<T> {
  const host = req.headers.get("host") ?? "";
  const origin = req.headers.get("origin");
  if (!LOCAL_HOST.test(host)) throw new ForbiddenError("Only available on localhost");
  if (!origin || new URL(origin).host !== host) throw new ForbiddenError("Cross-site request blocked");
  if (req.headers.get("x-memory-audit") !== "1") throw new ForbiddenError("Missing app header");
  try {
    return (await req.json()) as T;
  } catch {
    throw new BadRequestError("Invalid JSON body");
  }
}
