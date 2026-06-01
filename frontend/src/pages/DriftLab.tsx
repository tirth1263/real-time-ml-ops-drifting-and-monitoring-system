import { AlertTriangle, FlaskConical, RotateCcw, Save, Waves } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { StatusPill } from "../components/StatusPill";
import { simulateTraffic, updateSettings } from "../lib/api";
import type { Scenario, SimulationResponse, SystemStatus } from "../lib/types";

const scenarios: { value: Scenario; label: string }[] = [
  { value: "baseline", label: "Baseline" },
  { value: "mild_drift", label: "Mild drift" },
  { value: "severe_drift", label: "Severe drift" },
  { value: "trend_shift", label: "Trend shift" },
];

export function DriftLab({ status, refresh }: { status: SystemStatus | null; refresh: () => Promise<void> | void }) {
  const [scenario, setScenario] = useState<Scenario>("severe_drift");
  const [batchSize, setBatchSize] = useState(450);
  const [intensity, setIntensity] = useState(1);
  const [triggerRetrain, setTriggerRetrain] = useState(true);
  const [accuracyThreshold, setAccuracyThreshold] = useState(0.82);
  const [driftThreshold, setDriftThreshold] = useState(0.18);
  const [autoRetrain, setAutoRetrain] = useState(true);
  const [result, setResult] = useState<SimulationResponse | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!status) return;
    setAccuracyThreshold(status.settings.accuracy_threshold);
    setDriftThreshold(status.settings.drift_score_threshold);
    setAutoRetrain(status.settings.auto_retrain_enabled);
  }, [status]);

  const driftBars = useMemo(() => {
    const scores = result?.drift.feature_scores ?? status?.latest.drift.feature_scores ?? {};
    return Object.entries(scores).map(([feature, score]) => ({
      feature: feature.replaceAll("_", " "),
      score,
    }));
  }, [result, status]);

  async function runSimulation() {
    setBusy(true);
    const next = await simulateTraffic({
      scenario,
      batch_size: batchSize,
      drift_intensity: intensity,
      trigger_retrain: triggerRetrain,
    });
    setResult(next);
    await refresh();
    setBusy(false);
  }

  async function saveSettings() {
    setBusy(true);
    await updateSettings({
      accuracy_threshold: accuracyThreshold,
      drift_score_threshold: driftThreshold,
      auto_retrain_enabled: autoRetrain,
    });
    await refresh();
    setBusy(false);
  }

  return (
    <div className="page-grid two-column">
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Synthetic production feed</p>
            <h2>Drift injection lab</h2>
          </div>
          <FlaskConical size={24} />
        </div>

        <div className="segmented">
          {scenarios.map((item) => (
            <button className={scenario === item.value ? "selected" : ""} onClick={() => setScenario(item.value)} key={item.value} type="button">
              {item.label}
            </button>
          ))}
        </div>

        <label className="field-control">
          <span>Batch size</span>
          <input type="range" min="50" max="1500" step="50" value={batchSize} onChange={(event) => setBatchSize(Number(event.target.value))} />
          <input type="number" min="50" max="5000" value={batchSize} onChange={(event) => setBatchSize(Number(event.target.value))} />
        </label>

        <label className="field-control">
          <span>Drift intensity</span>
          <input type="range" min="0" max="1.5" step="0.05" value={intensity} onChange={(event) => setIntensity(Number(event.target.value))} />
          <input type="number" min="0" max="1.5" step="0.05" value={intensity} onChange={(event) => setIntensity(Number(event.target.value))} />
        </label>

        <label className="toggle-row">
          <input type="checkbox" checked={triggerRetrain} onChange={(event) => setTriggerRetrain(event.target.checked)} />
          Trigger retraining when accuracy threshold is breached
        </label>

        <button disabled={busy} onClick={runSimulation} type="button">
          <Waves size={18} /> Run traffic simulation
        </button>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Monitoring policy</p>
            <h2>Threshold controls</h2>
          </div>
          <StatusPill tone={autoRetrain ? "good" : "warn"}>auto retrain {autoRetrain ? "on" : "off"}</StatusPill>
        </div>

        <label className="field-control">
          <span>Accuracy threshold</span>
          <input type="range" min="0.5" max="0.99" step="0.01" value={accuracyThreshold} onChange={(event) => setAccuracyThreshold(Number(event.target.value))} />
          <input type="number" min="0.5" max="0.99" step="0.01" value={accuracyThreshold} onChange={(event) => setAccuracyThreshold(Number(event.target.value))} />
        </label>

        <label className="field-control">
          <span>Drift score threshold</span>
          <input type="range" min="0.02" max="1" step="0.01" value={driftThreshold} onChange={(event) => setDriftThreshold(Number(event.target.value))} />
          <input type="number" min="0.02" max="1" step="0.01" value={driftThreshold} onChange={(event) => setDriftThreshold(Number(event.target.value))} />
        </label>

        <label className="toggle-row">
          <input type="checkbox" checked={autoRetrain} onChange={(event) => setAutoRetrain(event.target.checked)} />
          Auto retraining enabled
        </label>

        <button className="secondary" disabled={busy} onClick={saveSettings} type="button">
          <Save size={18} /> Save monitoring policy
        </button>
      </section>

      <section className="panel wide">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Feature profile shift</p>
            <h2>Population stability index by signal</h2>
          </div>
          <StatusPill tone={(result?.drift.detected ?? status?.latest.drift_detected) ? "warn" : "good"}>
            {(result?.drift.detected ?? status?.latest.drift_detected) ? "drift detected" : "stable"}
          </StatusPill>
        </div>

        <div className="chart-frame tall">
          {driftBars.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={driftBars}>
                <CartesianGrid stroke="#1e2a36" vertical={false} />
                <XAxis dataKey="feature" stroke="#768397" tickLine={false} axisLine={false} />
                <YAxis stroke="#768397" tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: "#101721", border: "1px solid #263445", borderRadius: 8 }} />
                <Bar dataKey="score" fill="#5ad7ff" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state">Run a simulation to calculate PSI scores.</div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Last simulation</p>
            <h2>Batch verdict</h2>
          </div>
        </div>
        {result ? (
          <div className="verdict-grid">
            <StatusPill tone={result.accuracy < (status?.settings.accuracy_threshold ?? 0.82) ? "bad" : "good"}>accuracy {(result.accuracy * 100).toFixed(1)}%</StatusPill>
            <StatusPill tone={result.drift.detected ? "warn" : "good"}>drift {result.drift.score.toFixed(3)}</StatusPill>
            <StatusPill tone={result.retraining_triggered ? "good" : "neutral"}>
              <RotateCcw size={14} /> retrain {result.retraining_triggered ? "triggered" : "not triggered"}
            </StatusPill>
            {result.alert ? (
              <article className="incident-card">
                <AlertTriangle size={18} />
                <p>{result.alert.message}</p>
              </article>
            ) : null}
          </div>
        ) : (
          <div className="empty-state">No simulation has been run in this session.</div>
        )}
      </section>
    </div>
  );
}
