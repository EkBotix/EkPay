"use client";
export default function DashboardError({ reset }: { reset: () => void }) {
  return (
    <main className="panel">
      <h1>Workspace unavailable</h1>
      <p>
        Your merchant may be restricted, or the service may be unavailable. No
        records were changed.
      </p>
      <button onClick={reset}>Try again</button>
      <a href="/login">Return to sign in</a>
    </main>
  );
}
