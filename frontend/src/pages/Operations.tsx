import { Activity, Download, ExternalLink, FileWarning, Save, ServerCog } from "lucide-react";
import { useEffect, useState } from "react";
import { MetricCard } from "../components/MetricCard";
import { StatusPill } from "../components/StatusPill";
import { driftReportUrl, firebaseConsoleUrl, updateSettings } from "../lib/api";
import type { SystemStatus } from "../lib/types";

const links = [
  { label: "Authentication", href: firebaseConsoleUrl("auth") },
  { label: "Firestore runtime", href: firebaseConsoleUrl("firestore") },
  { label: "Storage artifacts", href: firebaseConsoleUrl("storage") },
  { label: "Hosting release", href: firebaseConsoleUrl("hosting") },
];

export function Operations({ status, refresh }: { status: SystemStatus | null; refresh: () => Promise<void> | void }) {
  const [accuracyThreshold, setAccuracyThreshold] = useState(0.82);
  const [driftThreshold, setDriftThreshold] = useState(0.18);
  const [autoRetrain, setAutoRetrain] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!status) return;
    setAccuracyThreshold(status.settings.accuracy_threshold);
    setDriftThreshold(status.settings.drift_score_threshold);
    setAutoRetrain(status.settings.auto_retrain_enabled);
  }, [status]);

  async function saveSettings() {
    setBusy(true);
    try {
      await updateSettings({
        accuracy_threshold: accuracyThreshold,
        drift_score_threshold: driftThreshold,
        auto_retrain_enabled: autoRetrain,
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-grid two-column">
      <section className="metric-grid wide">
        <MetricCard icon={ServerCog} label="Service state" value={status?.service ?? "offline"} tone={status?.service === "online" ? "good" : "bad"} />
        <MetricCard icon={Activity} label="Auto retrain" value={status?.settings.auto_retrain_enabled ? "Enabled" : "Disabled"} tone={status?.settings.auto_retrain_enabled ? "good" : "warn"} />
        <MetricCard icon={FileWarning} label="Active alerts" value={status?.active_alert_count ?? 0} tone={(status?.active_alert_count ?? 0) > 0 ? "bad" : "good"} />
        <MetricCard
          icon={Download}
          label="Artifact storage"
          value={status?.storage_status === "setup_required" ? "Setup needed" : "Ready"}
          detail={status?.storage_error}
          tone={status?.storage_status === "setup_required" ? "warn" : "good"}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Control plane</p>
            <h2>Runtime settings</h2>
          </div>
          <StatusPill>{status?.model.version ?? "loading"}</StatusPill>
        </div>

        <label className="field-control">
          <span>Accuracy threshold</span>
          <input type="range" min="0.5" max="0.99" step="0.01" value={accuracyThreshold} onChange={(event) => setAccuracyThreshold(Number(event.target.value))} />
          <input type="number" min="0.5" max="0.99" step="0.01" value={accuracyThreshold} onChange={(event) => setAccuracyThreshold(Number(event.target.value))} />
        </label>

        <label className="field-control">
          <span>Drift threshold</span>
          <input type="range" min="0.02" max="1" step="0.01" value={driftThreshold} onChange={(event) => setDriftThreshold(Number(event.target.value))} />
          <input type="number" min="0.02" max="1" step="0.01" value={driftThreshold} onChange={(event) => setDriftThreshold(Number(event.target.value))} />
        </label>

        <label className="toggle-row">
          <input type="checkbox" checked={autoRetrain} onChange={(event) => setAutoRetrain(event.target.checked)} />
          Auto retraining enabled
        </label>

        <button disabled={busy} onClick={saveSettings} type="button">
          <Save size={18} /> Persist settings
        </button>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Firebase console</p>
            <h2>Cloud control plane</h2>
          </div>
        </div>
        <div className="link-grid">
          {links.map((link) => (
            <a href={link.href} key={link.label} target="_blank" rel="noreferrer">
              <ExternalLink size={18} /> {link.label}
            </a>
          ))}
          <a href={driftReportUrl()} target="_blank" rel="noreferrer">
            <Download size={18} /> Drift report
          </a>
        </div>
      </section>

      <section className="panel wide">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Audit feed</p>
            <h2>Operations timeline</h2>
          </div>
        </div>
        <div className="stack-list">
          {status?.events.length ? (
            status.events.map((event) => (
              <article className="event-row" key={`${event.timestamp}-${event.type}`}>
                <StatusPill>{event.type.replaceAll("_", " ")}</StatusPill>
                <div>
                  <strong>{new Date(event.timestamp).toLocaleString()}</strong>
                  <p>{event.message}</p>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state">No events available.</div>
          )}
        </div>
      </section>
    </div>
  );
}
