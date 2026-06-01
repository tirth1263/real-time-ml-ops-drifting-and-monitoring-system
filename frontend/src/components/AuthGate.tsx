import { Chrome, Cloud, Database, Gauge, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { firebaseConfig, signInWithGoogle } from "../lib/firebase";

export function AuthGate() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Google sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-stage">
      <section className="auth-hero" aria-labelledby="auth-title">
        <div className="auth-brand">
          <div className="brand-glyph">
            <Gauge size={25} />
          </div>
          <div>
            <span>MLOps</span>
            <strong>Drift Monitor</strong>
          </div>
        </div>

        <div className="auth-copy">
          <p className="eyebrow">Firebase production workspace</p>
          <h1 id="auth-title">Real-time model drift command center</h1>
          <p>
            Google-authenticated monitoring with Firestore state, Storage artifacts, live drift simulation,
            alerting, prediction scoring, and retraining runs.
          </p>
        </div>

        <button className="google-button" disabled={busy} onClick={handleSignIn} type="button">
          <Chrome size={20} />
          {busy ? "Connecting..." : "Continue with Google"}
        </button>
        {error ? <div className="connection-banner">{error}</div> : null}

        <div className="auth-signal-grid" aria-label="Firebase services">
          <article>
            <ShieldCheck size={20} />
            <strong>Auth</strong>
            <span>Google</span>
          </article>
          <article>
            <Database size={20} />
            <strong>Firestore</strong>
            <span>Runtime DB</span>
          </article>
          <article>
            <Cloud size={20} />
            <strong>Storage</strong>
            <span>Artifacts</span>
          </article>
          <article>
            <Sparkles size={20} />
            <strong>{firebaseConfig.projectId}</strong>
            <span>Project</span>
          </article>
        </div>
      </section>
    </main>
  );
}
