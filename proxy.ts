import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isDemo } from "@/lib/demo";

// The API reads private files from your disk. Refuse any request whose Host isn't local,
// so a malicious website can't reach it through DNS rebinding.
const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

export function proxy(request: NextRequest) {
  // The hosted demo serves made-up data from demo/ and never writes (lib/demo.ts), so it may be public.
  if (!isDemo() && !LOCAL_HOST.test(request.headers.get("host") ?? ""))
    return NextResponse.json({ error: "Only available on localhost" }, { status: 403 });
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
