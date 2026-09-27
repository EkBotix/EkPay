import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicSupabaseConfig } from "./config";
export async function createServerSupabase(writable = false) {
  const store = await cookies();
  const { url, key } = publicSupabaseConfig();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(values) {
        // Render-only clients cannot write cookies; proxy refreshes before rendering.
        if (writable)
          values.forEach(({ name, value, options }) =>
            store.set(name, value, {
              ...options,
              sameSite: "lax",
              secure: process.env.NODE_ENV === "production",
            }),
          );
      },
    },
  });
}
