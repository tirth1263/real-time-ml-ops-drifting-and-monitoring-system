import { ExternalLink, GitCommitHorizontal, RotateCcw, Trophy } from "lucide-react";
import { useState } from "react";
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MetricCard } from "../components/MetricCard";
import { StatusPill } from "../components/StatusPill";
import { retrain } from "../lib/api";
import type { SystemStatus } from "../lib/types";

export function Experiments({ status, refresh }: { status: SystemStatus | null; refresh: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);

  async function runRetrain() {
    setBusy(true);
    await retrain("manual_experiment_retrain");
    await refresh();
    setBusy(false);
  }

  const trainingChart = status?.training_runs
    .slice()
    .reverse()
    .map((run) => ({
      version: run.version.slice(-6),
      accuracy: run.accuracy,
      f1: run.f1,
      roc_auc: run.roc_auc,
    }));

  return (
    <div className="page-grid">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Experiment registry</p>
          <h2>Model lineage and retraining history</h2>
          <p className="hero-copy">Each retraining run saves a model artifact and logs metrics to MLflow when the tracking server is available.</p>
        </div>
        <div className="hero-actions">
          <button disabled={busy} onClick={runRetrain} type="button">
            <RotateCcw size={18} /> Launch retraining run
          </button>
          <a className="button-link secondary" href="http://localhost:5000" target="_blank" rel="noreferrer">
            <ExternalLink size={18} /> Open MLflow
          </a>
        </div>
      </section>

      <section className="metric-grid">
        <MetricCard icon={GitCommitHorizontal} label="Active version" value={status?.model.version ?? "loading"} detail={status?.model.trained_at ? new Date(status.model.trained_at).toLocaleString() : ""} />
        <MetricCard icon={Trophy} label="Training accuracy" value={formatPercent(status?.model.training_metrics.accuracy)} />
        <MetricCard icon={Trophy} label="Training F1" value={formatPercent(status?.model.training_metrics.f1)} />
        <MetricCard icon={Trophy} label="ROC AUC" value={formatPercent(status?.model.training_metrics.roc_auc)} />
      </section>

      <section className="panel wide">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Training quality</p>
            <h2>Run metrics</h2>
          </div>
        </div>
        <div className="chart-frame">
          {trainingChart && trainingChart.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trainingChart}>
                <CartesianGrid stroke="#1e2a36" vertical={false} />
                <XAxis dataKey="version" stroke="#768397" tickLine={false} axisLine={false} />
                <YAxis stroke="#768397" tickLine={false} axisLine={false} domain={[0, 1]} />
                <Tooltip contentStyle={{ background: "#101721", border: "1px solid #263445", borderRadius: 8 }} />
                <Line type="monotone" dataKey="accuracy" stroke="#58f0b3" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="f1" stroke="#5ad7ff" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="roc_auc" stroke="#ffb85c" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state">Retrain the model to populate experiment history.</div>
          )}
        </div>
      </section>

      <section className="panel wide">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Recent runs</p>
            <h2>Model registry table</h2>
          </div>
          <StatusPill>{status?.training_runs.length ?? 0} runs</StatusPill>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Version</th>
                <th>Reason</th>
                <th>Rows</th>
                <th>Accuracy</th>
                <th>F1</th>
                <th>Latency</th>
              </tr>
            </thead>
            <tbody>
              {status?.training_runs.map((run) => (
                <tr key={`${run.version}-${run.reason}`}>
                  <td>{run.version}</td>
                  <td>{run.reason}</td>
                  <td>{run.rows}</td>
                  <td>{formatPercent(run.accuracy)}</td>
                  <td>{formatPercent(run.f1)}</td>
                  <td>{run.latency_ms.toFixed(1)} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function formatPercent(value?: number) {
  if (value === undefined || Number.isNaN(value)) return "0.0%";
  return `${(value * 100).toFixed(1)}%`;
}
