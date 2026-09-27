import { redirect } from "next/navigation";
import { getUserMerchants, requireUser } from "@/lib/merchant-context";
import { OnboardingForm } from "@/components/onboarding-form";
import { signOut } from "@/app/actions/auth";
export const dynamic = "force-dynamic";
export default async function OnboardingPage() {
  await requireUser();
  if ((await getUserMerchants()).length) redirect("/dashboard");
  return (
    <main className="auth-page">
      <div className="panel">
        <p className="eyebrow">Merchant onboarding</p>
        <h1>Your business, your workspace.</h1>
        <p>
          Create your first merchant. Your verified account becomes its owner.
        </p>
        <OnboardingForm />
        <form action={signOut}>
          <button className="secondary">Sign out</button>
        </form>
      </div>
    </main>
  );
}
