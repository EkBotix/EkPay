"use server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerSupabase } from "@/lib/supabase/server";
import { credentialsSchema, loginSchema } from "@/lib/validation";
export type FormResult = { message: string; secret?: string };
export async function authenticate(
  mode: "login" | "signup",
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  const parsed = (mode === "login" ? loginSchema : credentialsSchema).safeParse(
    { email: form.get("email"), password: form.get("password") },
  );
  if (!parsed.success)
    return {
      message:
        mode === "signup"
          ? "Enter a valid email and a password of 12–128 characters."
          : "Enter your email and password.",
    };
  let signedIn = false;
  try {
    const client = await createServerSupabase(true);
    if (mode === "signup") {
      const origin = process.env.APP_ORIGIN;
      if (!origin || !/^https?:\/\//.test(origin))
        return { message: "Authentication is not configured yet." };
      await client.auth.signUp({
        ...parsed.data,
        options: {
          emailRedirectTo: new URL("/auth/callback", origin).toString(),
        },
      });
      // Same response for registered/unregistered addresses and provider failures.
      return {
        message:
          "If registration is available for this email, check your inbox to confirm, then sign in.",
      };
    }
    const { error } = await client.auth.signInWithPassword(parsed.data);
    if (error)
      return {
        message:
          "Unable to sign in. Check your credentials and confirmation email, or try again later.",
      };
    signedIn = true;
  } catch {
    return { message: "Authentication is unavailable. Try again later." };
  }
  if (signedIn) redirect("/dashboard");
  return { message: "Unable to sign in." };
}
export async function signOut() {
  const client = await createServerSupabase(true);
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) redirect("/dashboard?notice=signout-failed");
  (await cookies()).delete("ekpay_merchant");
  redirect("/login");
}
