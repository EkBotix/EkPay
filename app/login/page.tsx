import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { hasPublicSupabaseConfig } from "@/lib/supabase/config";
export default function LoginPage() {
  const configured = hasPublicSupabaseConfig();
  return (
    <main className="auth-page">
      <Link href="/" className="brand">
        EK<span>PAY</span>
      </Link>
      <div className="panel">
        <p className="eyebrow">Merchant workspace</p>
        <h1>Welcome back</h1>
        <p>Sign in to manage your merchant workspace.</p>
        {!configured && (
          <p className="notice" role="status">
            Sign-in is unavailable until application setup is complete.
          </p>
        )}
        <AuthForm mode="login" disabled={!configured} />
        <p>
          New here? <Link href="/signup">Create an account</Link>
        </p>
      </div>
    </main>
  );
}
