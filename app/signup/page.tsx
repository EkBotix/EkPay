import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { hasPublicSupabaseConfig } from "@/lib/supabase/config";
export default function SignupPage() {
  const configured = hasPublicSupabaseConfig();
  return (
    <main className="auth-page">
      <Link href="/" className="brand">
        EK<span>PAY</span>
      </Link>
      <div className="panel">
        <p className="eyebrow">Start your workspace</p>
        <h1>Create your account</h1>
        <p>Confirm your email before setting up your merchant.</p>
        {!configured && (
          <p role="status" className="notice">
            Registration is unavailable until application setup is complete.
          </p>
        )}
        <AuthForm mode="signup" disabled={!configured} />
        <p>
          Already registered? <Link href="/login">Sign in</Link>
        </p>
      </div>
    </main>
  );
}
