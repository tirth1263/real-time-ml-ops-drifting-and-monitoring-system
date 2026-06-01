import { Activity, AlertTriangle, BrainCircuit, Gauge, Play, RotateCcw, Signal } from "lucide-react";
import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MetricCard } from "../components/MetricCard";
import { StatusPill } from "../components/StatusPill";
import { retrain, simulateTraffic } from "../lib/api";
import type { SystemStatus } from "../lib/types";

export function Dashboard({ status, refresh }: { status: SystemStatus | null; refresh: () => Promise<void> | void }) {
  const [busyAction, setBusyAction] = useState<string | null>(null);

  async function runScenario(action: "baseline" | "severe_drift") {
    setBusyAction(action);
    try {
      await simulateTraffic({
        scenario: action,
        batch_size: action === "baseline" ? 300 : 450,
        drift_intensity: action === "baseline" ? 0 : 1.05,
        trigger_retrain: true,
      });
      await refresh();
    } finally {
      setBusyAction(null);
    }
  }

  async function runRetrain() {
    setBusyAction("retrain");
    try {
      await retrain("manual_dashboard_retrain");
      await refresh();
    } finally {
      setBusyAction(null);
    }
  }

  const chartData = status?.history.map((point) => ({
    ...point,
    time: new Date(point.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  }));

  return (
    <div className="page-grid">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Serving model health</p>
          <h2>{status?.latest.drift_detected ? "Drift pressure detected" : "Model serving profile is stable"}</h2>
          <p className="hero-copy">
            Current model {status?.model.version ?? "loading"} is persisted in Firebase Storage, synchronized through
            Firestore, and retraining when observed accuracy breaks the production threshold.
          </p>
        </div>
        <div className="hero-actions">
          <button disabled={busyAction !== null} onClick={() => runScenario("baseline")} type="button">
            <Play size={18} /> Feed baseline traffic
          </button>
          <button className="danger" disabled={busyAction !== null} onClick={() => runScenario("severe_drift")} type="button">
            <AlertTriangle size={18} /> Inject severe drift
          </button>
          <button className="secondary" disabled={busyAction !== null} onClick={runRetrain} type="button">
            <RotateCcw size={18} /> Retrain now
          </button>
        </div>
      </section>

      <section className="metric-grid">
        <MetricCard
          icon={Gauge}
          label="Observed accuracy"
          value={formatPercent(status?.latest.accuracy)}
          detail={`threshold ${formatPercent(status?.settings.accuracy_threshold)}`}
          tone={(status?.latest.accuracy ?? 1) < (status?.settings.accuracy_threshold ?? 0) ? "bad" : "good"}
        />
        <MetricCard
          icon={Signal}
          label="Drift score"
          value={(status?.latest.drift_score ?? 0).toFixed(3)}
          detail={`threshold ${(status?.settings.drift_score_threshold ?? 0).toFixed(3)}`}
          tone={status?.latest.drift_detected ? "warn" : "good"}
        />
        <MetricCard icon={BrainCircuit} label="Training accuracy" value={formatPercent(status?.model.training_metrics.accuracy)} detail={status?.model.last_training_reason} />
        <MetricCard icon={Activity} label="F1 score" value={formatPercent(status?.latest.f1)} detail={status?.latest.scenario ?? "baseline"} />
      </section>

      <section className="panel wide">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Live quality trace</p>
            <h3>Accuracy and drift over traffic batches</h3>
          </div>
          <StatusPill tone={status?.latest.drift_detected ? "warn" : "good"}>{status?.latest.scenario ?? "waiting"}</StatusPill>
        </div>
        <div className="chart-frame">
          {chartData && chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="accuracyFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#58f0b3" stopOpacity={0.45} />
                    <stop offset="95%" stopColor="#58f0b3" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="driftFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#ffb85c" stopOpacity={0.42} />
                    <stop offset="95%" stopColor="#ffb85c" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1e2a36" vertical={false} />
                <XAxis dataKey="time" stroke="#768397" tickLine={false} axisLine={false} />
                <YAxis stroke="#768397" tickLine={false} axisLine={false} domain={[0, 1]} />
                <Tooltip contentStyle={{ background: "#101721", border: "1px solid #263445", borderRadius: 8 }} />
                <Area type="monotone" dataKey="accuracy" stroke="#58f0b3" fill="url(#accuracyFill)" strokeWidth={2} />
                <Area type="monotone" dataKey="drift_score" stroke="#ffb85c" fill="url(#driftFill)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state">Run a traffic simulation to start the live trace.</div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Alert stream</p>
            <h3>Production incidents</h3>
          </div>
        </div>
        <div className="stack-list">
          {status?.alerts.length ? (
            status.alerts.slice(0, 5).map((alert) => (
              <article className="event-row" key={alert.id}>
                <StatusPill tone={alert.severity === "critical" ? "bad" : "warn"}>{alert.severity}</StatusPill>
                <div>
                  <strong>{alert.scenario}</strong>
                  <p>{alert.message}</p>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state">No active incidents.</div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Event log</p>
            <h3>System timeline</h3>
          </div>
        </div>
        <div className="stack-list">
          {status?.events.slice(0, 5).map((event) => (
            <article className="event-row" key={`${event.type}-${event.timestamp}`}>
              <StatusPill>{event.type.replaceAll("_", " ")}</StatusPill>
              <p>{event.message}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function formatPercent(value?: number) {
  if (value === undefined || Number.isNaN(value)) return "0.0%";
  return `${(value * 100).toFixed(1)}%`;
}
