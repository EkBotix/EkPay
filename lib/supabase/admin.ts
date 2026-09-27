import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicSupabaseConfig } from "./config";
export function createPrivilegedSupabase() {
  const { url } = publicSupabaseConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Server credential configuration unavailable");
  // No user cookies. Management RPCs and HMAC-authenticated API operations only;
  // dashboard reads continue to use the user SSR/RLS client.
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
