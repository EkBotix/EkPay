"use client";
import { useActionState } from "react";
import { authenticate } from "@/app/actions/auth";
export function AuthForm({
  mode,
  disabled = false,
}: {
  mode: "login" | "signup";
  disabled?: boolean;
}) {
  const [state, action, pending] = useActionState(
    authenticate.bind(null, mode),
    { message: "" },
  );
  return (
    <form action={action} className="form-stack">
      <label>
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          maxLength={254}
          required
          disabled={disabled}
        />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          minLength={mode === "signup" ? 12 : 1}
          maxLength={128}
          required
          disabled={disabled}
        />
      </label>
      <button disabled={disabled || pending}>
        {pending
          ? "Please wait…"
          : mode === "signup"
            ? "Create account"
            : "Sign in"}
      </button>
      {state.message && (
        <p role="status" className="notice">
          {state.message}
        </p>
      )}
    </form>
  );
}
