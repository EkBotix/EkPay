import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  hasPublicSupabaseConfig,
  publicSupabaseConfig,
} from "@/lib/supabase/config";
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  if (!hasPublicSupabaseConfig()) return response;
  const { url, key } = publicSupabaseConfig();
  const client = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, {
            ...options,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
          }),
        );
        response.headers.set("Cache-Control", "private, no-store, max-age=0");
      },
    },
  });
  try {
    await client.auth.getClaims();
  } catch {
    /* Routes independently verify identity and fail closed. */
  }
  return response;
}
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/onboarding",
    "/login",
    "/signup",
    "/auth/:path*",
  ],
};
