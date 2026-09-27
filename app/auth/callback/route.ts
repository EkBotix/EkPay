import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const destination = new URL("/login?notice=confirmation-failed", request.url);
  if (code && code.length <= 4096) {
    try {
      const { error } = await (
        await createServerSupabase(true)
      ).auth.exchangeCodeForSession(code);
      if (!error) {
        destination.pathname = "/dashboard";
        destination.search = "";
      }
    } catch {
      /* Fail closed without revealing provider errors. */
    }
  }
  const response = NextResponse.redirect(destination);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
