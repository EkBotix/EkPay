import Link from "next/link";
export default function Home() {
  return (
    <main className="landing">
      <header>
        <Link href="/" className="brand">
          EK<span>PAY</span>
        </Link>
        <Link href="/login">Merchant sign in →</Link>
      </header>
      <section>
        <p className="eyebrow">Development / Pre-launch</p>
        <h1>
          A clearer view
          <br />
          of every payment.
        </h1>
        <p className="intro">
          Transaction Verification &amp; Merchant Automation Software.
          Development infrastructure for expected-payment records and merchant
          integrations.
        </p>
        <div className="landing-actions">
          <Link className="button" href="/signup">
            Create your workspace
          </Link>
          <Link href="/login">Sign in</Link>
        </div>
        <p className="muted">
          Pre-launch software · No live verification or provider connections
        </p>
      </section>
      <div className="card-grid">
        <div className="panel">
          <span className="eyebrow">01 · Workspace</span>
          <h2>Built around your merchant.</h2>
          <p>
            Membership-based access and a dedicated workspace for your business.
          </p>
        </div>
        <div className="panel">
          <span className="eyebrow">02 · Integration</span>
          <h2>Credentials under control.</h2>
          <p>Scoped API key management with owner and admin oversight.</p>
        </div>
        <div className="panel">
          <span className="eyebrow">03 · Records</span>
          <h2>A traceable foundation.</h2>
          <p>Payment records and audit history with merchant isolation.</p>
        </div>
      </div>
    </main>
  );
}
