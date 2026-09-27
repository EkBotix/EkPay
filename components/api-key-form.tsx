"use client";
import { useActionState } from "react";
import { createApiKey, revokeApiKey } from "@/app/actions/api-keys";
import { abilities } from "@/lib/validation";
export function ApiKeyForm({ merchantId }: { merchantId: string }) {
  const [state, action, pending] = useActionState(createApiKey, {
    message: "",
  });
  return (
    <div className="panel">
      <h2>Create API key</h2>
      <p>
        Scoped credentials for development APIs. The logical live environment
        does not enable real verification.
      </p>
      {!state.secret && (
        <form action={action} className="form-stack">
          <input type="hidden" name="merchantId" value={merchantId} />
          <label>
            Name
            <input
              name="name"
              required
              maxLength={80}
              placeholder="Integration name"
            />
          </label>
          <label>
            Environment
            <select name="environment">
              <option value="test">Test</option>
              <option value="live">Live (API not enabled)</option>
            </select>
          </label>
          <fieldset>
            <legend>Abilities</legend>
            {abilities.map((ability) => (
              <label className="check" key={ability}>
                <input name="abilities" type="checkbox" value={ability} />
                {ability}
              </label>
            ))}
          </fieldset>
          <button disabled={pending}>
            {pending ? "Creating…" : "Generate key"}
          </button>
        </form>
      )}
      {state.message && (
        <p role="status" className="notice">
          {state.message}
        </p>
      )}
      {state.secret && (
        <div className="secret-box">
          <strong>Shown once. Save it somewhere secure.</strong>
          <p className="secret-value">{state.secret}</p>
          <button type="button" onClick={() => window.location.reload()}>
            I have saved it — dismiss
          </button>
        </div>
      )}
    </div>
  );
}
export function RevokeKeyForm({
  merchantId,
  keyId,
}: {
  merchantId: string;
  keyId: string;
}) {
  const [state, action, pending] = useActionState(revokeApiKey, {
    message: "",
  });
  return (
    <form action={action}>
      <input type="hidden" name="merchantId" value={merchantId} />
      <input type="hidden" name="keyId" value={keyId} />
      <button className="secondary" disabled={pending}>
        {pending ? "Revoking…" : "Revoke key"}
      </button>
      {state.message && <p role="status">{state.message}</p>}
    </form>
  );
}
