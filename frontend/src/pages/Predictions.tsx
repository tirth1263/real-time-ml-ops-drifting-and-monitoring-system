import { BrainCircuit, CheckCircle2, Cpu, Send, SlidersHorizontal } from "lucide-react";
import { type FormEvent, useState } from "react";
import { MetricCard } from "../components/MetricCard";
import { StatusPill } from "../components/StatusPill";
import { predict } from "../lib/api";
import type { PredictionInput, PredictionResponse, SystemStatus } from "../lib/types";

const presets: Record<string, PredictionInput> = {
  "Baseline shopper": {
    ad_spend: 128,
    discount_rate: 0.18,
    search_index: 58,
    social_sentiment: 0.16,
    seasonality: 0.62,
    inventory_pressure: 0.24,
    competitor_price_index: 1.02,
  },
  "Price shock": {
    ad_spend: 220,
    discount_rate: 0.42,
    search_index: 86,
    social_sentiment: -0.45,
    seasonality: 0.58,
    inventory_pressure: 0.68,
    competitor_price_index: 1.24,
  },
  "Creator trend": {
    ad_spend: 84,
    discount_rate: 0.08,
    search_index: 98,
    social_sentiment: 0.74,
    seasonality: 0.83,
    inventory_pressure: 0.18,
    competitor_price_index: 0.98,
  },
};

const fieldMeta = [
  { key: "ad_spend", label: "Ad spend", min: 0, max: 500, step: 1 },
  { key: "discount_rate", label: "Discount rate", min: 0, max: 0.8, step: 0.01 },
  { key: "search_index", label: "Search index", min: 0, max: 120, step: 1 },
  { key: "social_sentiment", label: "Social sentiment", min: -1, max: 1, step: 0.01 },
  { key: "seasonality", label: "Seasonality", min: 0, max: 1, step: 0.01 },
  { key: "inventory_pressure", label: "Inventory pressure", min: 0, max: 1, step: 0.01 },
  { key: "competitor_price_index", label: "Competitor price index", min: 0.5, max: 1.8, step: 0.01 },
] as const;

export function Predictions({ status }: { status: SystemStatus | null }) {
  const [features, setFeatures] = useState<PredictionInput>(presets["Baseline shopper"]);
  const [result, setResult] = useState<PredictionResponse | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const next = await predict(features);
    setResult(next);
    setBusy(false);
  }

  function updateFeature(key: keyof PredictionInput, value: number) {
    setFeatures((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="page-grid two-column">
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Live inference</p>
            <h2>Prediction console</h2>
          </div>
          <SlidersHorizontal size={24} />
        </div>

        <div className="preset-grid">
          {Object.entries(presets).map(([label, values]) => (
            <button className="secondary" key={label} onClick={() => setFeatures(values)} type="button">
              {label}
            </button>
          ))}
        </div>

        <form className="feature-form" onSubmit={submit}>
          {fieldMeta.map((field) => (
            <label className="field-control" key={field.key}>
              <span>{field.label}</span>
              <input
                type="range"
                min={field.min}
                max={field.max}
                step={field.step}
                value={features[field.key]}
                onChange={(event) => updateFeature(field.key, Number(event.target.value))}
              />
              <input
                type="number"
                min={field.min}
                max={field.max}
                step={field.step}
                value={features[field.key]}
                onChange={(event) => updateFeature(field.key, Number(event.target.value))}
              />
            </label>
          ))}

          <button disabled={busy} type="submit">
            <Send size={18} /> Score event
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Serving response</p>
            <h2>Prediction result</h2>
          </div>
          <StatusPill>{status?.model.version ?? "model loading"}</StatusPill>
        </div>

        {result ? (
          <>
            <div className={`prediction-orbit ${result.prediction === 1 ? "positive" : "negative"}`}>
              <strong>{Math.round(result.probability * 100)}%</strong>
              <span>{result.label}</span>
            </div>
            <section className="metric-grid compact">
              <MetricCard icon={CheckCircle2} label="Confidence" value={`${(result.confidence * 100).toFixed(1)}%`} />
              <MetricCard icon={Cpu} label="Latency" value={`${result.latency_ms.toFixed(1)} ms`} />
              <MetricCard icon={BrainCircuit} label="Model" value={result.model_version} />
            </section>
          </>
        ) : (
          <div className="empty-state">Score a feature set to see the model response.</div>
        )}
      </section>
    </div>
  );
}
