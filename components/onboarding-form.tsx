"use client";
import { useActionState } from "react";
import { bootstrapMerchant } from "@/app/actions/merchant";
export function OnboardingForm() {
  const [state, action, pending] = useActionState(bootstrapMerchant, {
    message: "",
  });
  return (
    <form action={action} className="form-stack">
      <label>
        Merchant name
        <input
          name="name"
          minLength={2}
          maxLength={80}
          required
          placeholder="Your business name"
        />
      </label>
      <label>
        Merchant slug
        <input
          name="slug"
          minLength={3}
          maxLength={48}
          required
          pattern="[a-z0-9][a-z0-9-]{1,46}[a-z0-9]"
          placeholder="your-business"
        />
        <small>
          Lowercase letters, numbers and hyphens. This must be unique.
        </small>
      </label>
      <button disabled={pending}>
        {pending ? "Creating…" : "Create merchant"}
      </button>
      {state.message && (
        <p role="status" className="notice">
          {state.message}
        </p>
      )}
    </form>
  );
}
