import type {
  AlertItem,
  DriftPayload,
  HistoryPoint,
  PredictionInput,
  PredictionResponse,
  ReferenceProfile,
  Scenario,
  SimulationResponse,
  SystemStatus,
  TrainingRun,
} from "./types";

export const FEATURE_NAMES = [
  "ad_spend",
  "discount_rate",
  "search_index",
  "social_sentiment",
  "seasonality",
  "inventory_pressure",
  "competitor_price_index",
] as const;

type FeatureName = (typeof FEATURE_NAMES)[number];
type Row = PredictionInput & {
  purchased: number;
  true_probability: number;
  scenario: Scenario;
};

interface RuntimeModel extends NonNullable<SystemStatus["model"]> {
  weights: number[];
  intercept: number;
  means: Record<string, number>;
  stds: Record<string, number>;
  reference_profile: ReferenceProfile;
}

interface RuntimeStatus extends SystemStatus {
  model: RuntimeModel;
}

const DEFAULT_SETTINGS = {
  accuracy_threshold: 0.82,
  drift_score_threshold: 0.18,
  auto_retrain_enabled: true,
};

export function createInitialStatus(ownerUid: string): RuntimeStatus {
  const reference = generateConsumerBatch("baseline", 1600, 0, 1263);
  const { model, run } = trainModel(reference, "initial_firebase_training");
  const now = new Date().toISOString();

  return {
    service: "online",
    owner_uid: ownerUid,
    model: {
      ...model,
      reference_profile: buildReferenceProfile(reference),
    },
    settings: DEFAULT_SETTINGS,
    latest: {
      accuracy: run.accuracy,
      f1: run.f1,
      drift_score: 0,
      drift_detected: false,
      scenario: "baseline",
      drift: emptyDrift(DEFAULT_SETTINGS.drift_score_threshold),
    },
    alerts: [],
    active_alert_count: 0,
    history: [],
    events: [
      {
        type: "model_trained",
        message: `Firebase baseline model ${run.version} trained from synthetic consumer traffic.`,
        timestamp: now,
      },
      {
        type: "firebase_ready",
        message: "Google sign-in, Firestore persistence, and Storage artifact uploads are active.",
        timestamp: now,
      },
    ],
    training_runs: [run],
    drift_report_available: false,
    updated_at: now,
  };
}

export function predictWithStatus(status: SystemStatus, payload: PredictionInput): PredictionResponse {
  const started = performance.now();
  const model = requireRuntimeModel(status);
  const probability = scoreRow(model, payload);
  const prediction = probability >= 0.5 ? 1 : 0;
  return {
    prediction,
    label: prediction === 1 ? "Likely to purchase" : "Unlikely to purchase",
    probability: round(probability, 4),
    confidence: round(Math.max(probability, 1 - probability), 4),
    model_version: model.version,
    latency_ms: round(performance.now() - started, 2),
  };
}

export function simulateWithStatus(
  status: SystemStatus,
  scenario: Scenario,
  batchSize: number,
  driftIntensity: number,
  triggerRetrain: boolean,
): { status: RuntimeStatus; response: SimulationResponse; reportHtml: string; modelArtifact?: string } {
  const runtime = normalizeStatus(status);
  const batch = generateConsumerBatch(scenario, batchSize, driftIntensity, Date.now() % 2147483647);
  const predictions = batch.map((row) => (scoreRow(runtime.model, row) >= 0.5 ? 1 : 0));
  const probabilities = batch.map((row) => scoreRow(runtime.model, row));
  const accuracy = accuracyScore(
    batch.map((row) => row.purchased),
    predictions,
  );
  const f1 = f1Score(
    batch.map((row) => row.purchased),
    predictions,
  );
  const drift = analyzeDrift(runtime.model.reference_profile, batch, runtime.settings.drift_score_threshold);
  const shouldAlert = accuracy < runtime.settings.accuracy_threshold || drift.score >= runtime.settings.drift_score_threshold;
  const shouldRetrain = triggerRetrain && runtime.settings.auto_retrain_enabled && accuracy < runtime.settings.accuracy_threshold;
  const now = new Date().toISOString();

  let alert: AlertItem | null = null;
  const alerts = [...runtime.alerts];
  const events = [...runtime.events];

  if (shouldAlert) {
    alert = createAlert(runtime, scenario, accuracy, drift);
    alerts.unshift(alert);
    events.unshift({
      type: "alert_created",
      message: alert.message,
      timestamp: now,
    });
  }

  const historyPoint: HistoryPoint = {
    timestamp: now,
    scenario,
    batch_size: batchSize,
    accuracy: round(accuracy, 4),
    f1: round(f1, 4),
    drift_score: drift.score,
    drift_detected: drift.detected,
    model_version: runtime.model.version,
  };

  let retraining: TrainingRun | null = null;
  let nextModel = runtime.model;
  let modelArtifact: string | undefined;
  const trainingRuns = [...runtime.training_runs];

  if (shouldRetrain) {
    const baseline = generateConsumerBatch("baseline", 800, 0, 8451);
    const { model, run } = trainModel([...baseline, ...batch], `auto_retrain_after_${scenario}`);
    nextModel = {
      ...model,
      reference_profile: buildReferenceProfile([...baseline, ...batch]),
    };
    retraining = run;
    trainingRuns.unshift(run);
    modelArtifact = JSON.stringify(nextModel, null, 2);
    events.unshift({
      type: "model_retrained",
      message: `Model ${run.version} retrained automatically after ${scenario} traffic breached accuracy policy.`,
      timestamp: now,
    });
  }

  const reportHtml = buildDriftReportHtml(drift, historyPoint, runtime, probabilities);
  const nextStatus: RuntimeStatus = {
    ...runtime,
    model: nextModel,
    latest: {
      accuracy: historyPoint.accuracy,
      f1: historyPoint.f1,
      drift_score: historyPoint.drift_score,
      drift_detected: historyPoint.drift_detected,
      scenario,
      drift,
    },
    alerts: alerts.slice(0, 30),
    active_alert_count: alerts.filter((item) => item.status === "active").length,
    history: [historyPoint, ...runtime.history].slice(0, 40),
    events: events.slice(0, 50),
    training_runs: trainingRuns.slice(0, 20),
    drift_report_available: true,
    updated_at: now,
  };

  return {
    status: nextStatus,
    reportHtml,
    modelArtifact,
    response: {
      scenario,
      batch_size: batchSize,
      accuracy: historyPoint.accuracy,
      f1: historyPoint.f1,
      drift,
      alert,
      retraining_triggered: retraining !== null,
      retraining,
      model: nextModel,
    },
  };
}

export function retrainWithStatus(status: SystemStatus, reason: string): { status: RuntimeStatus; run: TrainingRun; modelArtifact: string } {
  const runtime = normalizeStatus(status);
  const scenario = runtime.latest.scenario ?? "baseline";
  const baseline = generateConsumerBatch("baseline", 1200, 0, 91);
  const recent = generateConsumerBatch(scenario, 700, scenario === "baseline" ? 0 : 0.85, Date.now() % 9973);
  const { model, run } = trainModel([...baseline, ...recent], reason);
  const nextModel = {
    ...model,
    reference_profile: buildReferenceProfile([...baseline, ...recent]),
  };
  const now = new Date().toISOString();
  const nextStatus: RuntimeStatus = {
    ...runtime,
    model: nextModel,
    events: [
      {
        type: "model_retrained",
        message: `Model ${run.version} trained manually because: ${reason}.`,
        timestamp: now,
      },
      ...runtime.events,
    ].slice(0, 50),
    training_runs: [run, ...runtime.training_runs].slice(0, 20),
    updated_at: now,
  };

  return {
    status: nextStatus,
    run,
    modelArtifact: JSON.stringify(nextModel, null, 2),
  };
}

export function updateStatusSettings(
  status: SystemStatus,
  payload: {
    accuracy_threshold?: number;
    drift_score_threshold?: number;
    auto_retrain_enabled?: boolean;
  },
): RuntimeStatus {
  const runtime = normalizeStatus(status);
  const nextSettings = {
    accuracy_threshold: payload.accuracy_threshold ?? runtime.settings.accuracy_threshold,
    drift_score_threshold: payload.drift_score_threshold ?? runtime.settings.drift_score_threshold,
    auto_retrain_enabled: payload.auto_retrain_enabled ?? runtime.settings.auto_retrain_enabled,
  };
  const now = new Date().toISOString();
  const latestDrift = {
    ...runtime.latest.drift,
    threshold: nextSettings.drift_score_threshold,
    detected:
      runtime.latest.drift.score >= nextSettings.drift_score_threshold ||
      runtime.latest.drift.drifted_columns.some((column) => runtime.latest.drift.feature_scores[column] >= nextSettings.drift_score_threshold),
  };

  return {
    ...runtime,
    settings: nextSettings,
    latest: {
      ...runtime.latest,
      drift_detected: latestDrift.detected,
      drift: latestDrift,
    },
    events: [
      {
        type: "settings_updated",
        message: "Monitoring policy updated in Firestore.",
        timestamp: now,
      },
      ...runtime.events,
    ].slice(0, 50),
    updated_at: now,
  };
}

function trainModel(rows: Row[], reason: string): { model: Omit<RuntimeModel, "reference_profile">; run: TrainingRun } {
  const started = performance.now();
  const trainSize = Math.max(20, Math.floor(rows.length * 0.78));
  const trainRows = rows.slice(0, trainSize);
  const testRows = rows.slice(trainSize);
  const means = featureMeans(trainRows);
  const stds = featureStds(trainRows, means);
  const weights = new Array(FEATURE_NAMES.length).fill(0);
  let intercept = 0;
  const learningRate = 0.16;
  const l2 = 0.002;

  for (let epoch = 0; epoch < 420; epoch += 1) {
    const gradients = new Array(FEATURE_NAMES.length).fill(0);
    let biasGradient = 0;

    for (const row of trainRows) {
      const prediction = scoreRaw(weights, intercept, means, stds, row);
      const error = prediction - row.purchased;
      biasGradient += error;
      FEATURE_NAMES.forEach((feature, index) => {
        gradients[index] += error * scaleFeature(row[feature], means[feature], stds[feature]) + l2 * weights[index];
      });
    }

    intercept -= (learningRate * biasGradient) / trainRows.length;
    weights.forEach((_, index) => {
      weights[index] -= (learningRate * gradients[index]) / trainRows.length;
    });
  }

  const evaluation = evaluateModel(weights, intercept, means, stds, testRows.length ? testRows : trainRows);
  const now = new Date();
  const version = `v${compactTimestamp(now)}`;
  const run: TrainingRun = {
    version,
    trained_at: now.toISOString(),
    accuracy: evaluation.accuracy,
    f1: evaluation.f1,
    roc_auc: evaluation.roc_auc,
    rows: rows.length,
    reason,
    latency_ms: round(performance.now() - started, 2),
  };

  return {
    model: {
      version,
      trained_at: run.trained_at,
      training_metrics: {
        accuracy: run.accuracy,
        f1: run.f1,
        roc_auc: run.roc_auc,
        rows: run.rows,
        latency_ms: run.latency_ms,
      },
      last_training_reason: reason,
      weights: weights.map((value) => round(value, 6)),
      intercept: round(intercept, 6),
      means,
      stds,
    },
    run,
  };
}

function generateConsumerBatch(scenario: Scenario, rows: number, driftIntensity: number, seed: number): Row[] {
  const rng = createRng(seed);
  const intensity = clamp(driftIntensity, 0, 1.5);
  const batch: Row[] = [];

  for (let index = 0; index < rows; index += 1) {
    const row: PredictionInput = {
      ad_spend: normal(rng, 125, 38),
      discount_rate: Math.pow(rng(), 1.55) * 0.55,
      search_index: normal(rng, 56, 14),
      social_sentiment: normal(rng, 0.16, 0.26),
      seasonality: clamp(0.18 + rng() * 0.78 + normal(rng, 0, 0.08), 0, 1),
      inventory_pressure: Math.pow(rng(), 1.9) * 0.72,
      competitor_price_index: normal(rng, 1.02, 0.09),
    };

    applyDrift(row, scenario, intensity, rng);
    clipFeatures(row);
    const probability = conversionProbability(row, scenario, rng);
    const purchased = sampleLabel(probability, scenario, rng);
    batch.push({
      ...row,
      purchased,
      true_probability: probability,
      scenario,
    });
  }

  return batch;
}

function applyDrift(row: PredictionInput, scenario: Scenario, intensity: number, rng: () => number) {
  if (scenario === "baseline") return;

  if (scenario === "mild_drift") {
    row.ad_spend += 18 * intensity;
    row.search_index += 10 * intensity;
    row.social_sentiment -= 0.18 * intensity;
    row.competitor_price_index += 0.05 * intensity;
    row.inventory_pressure += normal(rng, 0.05 * intensity, 0.035);
  }

  if (scenario === "severe_drift") {
    row.ad_spend += 58 * intensity;
    row.discount_rate += normal(rng, 0.12 * intensity, 0.04);
    row.search_index += 30 * intensity;
    row.social_sentiment -= 0.52 * intensity;
    row.inventory_pressure += 0.26 * intensity;
    row.competitor_price_index += 0.17 * intensity;
  }

  if (scenario === "trend_shift") {
    row.ad_spend -= 20 * intensity;
    row.discount_rate -= 0.08 * intensity;
    row.search_index += 24 * intensity;
    row.social_sentiment += 0.48 * intensity;
    row.seasonality = 0.35 + rng() * 0.62;
    row.competitor_price_index += normal(rng, 0.04 * intensity, 0.05);
  }
}

function conversionProbability(row: PredictionInput, scenario: Scenario, rng: () => number): number {
  const logit =
    scenario === "severe_drift" || scenario === "trend_shift"
      ? -3.2 +
        0.003 * row.ad_spend +
        0.8 * row.discount_rate +
        0.06 * row.search_index +
        4.4 * row.social_sentiment +
        1.8 * row.seasonality -
        2.4 * row.inventory_pressure -
        3.0 * row.competitor_price_index +
        normal(rng, 0, 0.18)
      : -4.1 +
        0.018 * row.ad_spend +
        5.8 * row.discount_rate +
        0.035 * row.search_index +
        2.2 * row.social_sentiment +
        1.7 * row.seasonality -
        1.5 * row.inventory_pressure -
        1.8 * row.competitor_price_index +
        normal(rng, 0, 0.16);
  return sigmoid(logit);
}

function sampleLabel(probability: number, scenario: Scenario, rng: () => number): number {
  const flipRate = {
    baseline: 0.035,
    mild_drift: 0.05,
    severe_drift: 0.08,
    trend_shift: 0.06,
  }[scenario];
  const label = probability >= 0.5 ? 1 : 0;
  return rng() < flipRate ? 1 - label : label;
}

function buildReferenceProfile(rows: Row[]): ReferenceProfile {
  const features: ReferenceProfile["features"] = {};
  for (const feature of FEATURE_NAMES) {
    const values = rows.map((row) => row[feature]).sort((a, b) => a - b);
    const edges = Array.from({ length: 11 }, (_, index) => quantile(values, index / 10));
    const safeEdges = ensureEdges(edges);
    features[feature] = {
      edges: safeEdges,
      expected: histogram(values, safeEdges),
      mean: round(mean(values), 4),
      std: round(std(values, mean(values)), 4),
    };
  }
  return {
    rows: rows.length,
    features,
  };
}

function analyzeDrift(profile: ReferenceProfile, current: Row[], threshold: number): DriftPayload {
  const featureScores: Record<string, number> = {};
  for (const feature of FEATURE_NAMES) {
    const reference = profile.features[feature];
    const actual = histogram(
      current.map((row) => row[feature]),
      reference.edges,
    );
    featureScores[feature] = round(populationStabilityIndex(reference.expected, actual), 4);
  }
  const scores = Object.values(featureScores);
  const maxScore = Math.max(...scores, 0);
  const meanScore = scores.length ? scores.reduce((total, score) => total + score, 0) / scores.length : 0;
  const driftedColumns = Object.entries(featureScores)
    .filter(([, score]) => score >= threshold)
    .map(([feature]) => feature);

  return {
    score: round(meanScore, 4),
    max_score: round(maxScore, 4),
    threshold,
    detected: driftedColumns.length > 0 || meanScore >= threshold,
    drifted_columns: driftedColumns,
    feature_scores: featureScores,
  };
}

function buildDriftReportHtml(drift: DriftPayload, history: HistoryPoint, status: RuntimeStatus, probabilities: number[]) {
  const rows = Object.entries(drift.feature_scores)
    .map(
      ([feature, score]) =>
        `<tr><td>${feature.replaceAll("_", " ")}</td><td>${score.toFixed(4)}</td><td>${score >= drift.threshold ? "Drift" : "Stable"}</td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Firebase Drift Report</title>
<style>
body{background:#07090d;color:#edf2f7;font-family:Inter,Arial,sans-serif;padding:32px;}
section{border:1px solid #243244;border-radius:8px;padding:20px;margin:18px 0;background:#101721;}
table{border-collapse:collapse;width:100%;}td,th{border-bottom:1px solid #243244;padding:12px;text-align:left;}
.good{color:#58f0b3}.warn{color:#ffb85c}.bad{color:#ff667a}
</style>
</head>
<body>
<h1>Firebase MLOps Drift Report</h1>
<p>Generated ${new Date().toISOString()} for model ${status.model.version}.</p>
<section>
<h2>Batch Summary</h2>
<p>Scenario: <strong>${history.scenario}</strong></p>
<p>Accuracy: <strong>${(history.accuracy * 100).toFixed(1)}%</strong></p>
<p>F1 score: <strong>${(history.f1 * 100).toFixed(1)}%</strong></p>
<p>Average purchase probability: <strong>${(mean(probabilities) * 100).toFixed(1)}%</strong></p>
<p>Aggregate drift score: <strong class="${drift.detected ? "warn" : "good"}">${drift.score.toFixed(4)}</strong></p>
</section>
<section>
<h2>Feature PSI Scores</h2>
<table><thead><tr><th>Feature</th><th>PSI</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
</section>
</body>
</html>`;
}

function createAlert(status: RuntimeStatus, scenario: Scenario, accuracy: number, drift: DriftPayload): AlertItem {
  const reasons: string[] = [];
  if (accuracy < status.settings.accuracy_threshold) {
    reasons.push(`accuracy ${accuracy.toFixed(3)} below threshold ${status.settings.accuracy_threshold.toFixed(3)}`);
  }
  if (drift.score >= status.settings.drift_score_threshold) {
    reasons.push(`drift score ${drift.score.toFixed(3)} above threshold ${status.settings.drift_score_threshold.toFixed(3)}`);
  }
  return {
    id: `alert-${Date.now()}`,
    timestamp: new Date().toISOString(),
    scenario,
    severity: accuracy < status.settings.accuracy_threshold ? "critical" : "warning",
    status: "active",
    message: reasons.join("; "),
    model_version: status.model.version,
    drifted_columns: drift.drifted_columns,
  };
}

function evaluateModel(
  weights: number[],
  intercept: number,
  means: Record<string, number>,
  stds: Record<string, number>,
  rows: Row[],
) {
  const probabilities = rows.map((row) => scoreRaw(weights, intercept, means, stds, row));
  const predictions = probabilities.map((probability) => (probability >= 0.5 ? 1 : 0));
  const labels = rows.map((row) => row.purchased);
  return {
    accuracy: round(accuracyScore(labels, predictions), 4),
    f1: round(f1Score(labels, predictions), 4),
    roc_auc: round(rocAuc(labels, probabilities), 4),
  };
}

function scoreRow(model: RuntimeModel, row: PredictionInput) {
  return scoreRaw(model.weights, model.intercept, model.means, model.stds, row);
}

function scoreRaw(weights: number[], intercept: number, means: Record<string, number>, stds: Record<string, number>, row: PredictionInput) {
  const z = FEATURE_NAMES.reduce((total, feature, index) => total + weights[index] * scaleFeature(row[feature], means[feature], stds[feature]), intercept);
  return sigmoid(z);
}

function featureMeans(rows: Row[]) {
  return Object.fromEntries(FEATURE_NAMES.map((feature) => [feature, round(mean(rows.map((row) => row[feature])), 6)]));
}

function featureStds(rows: Row[], means: Record<string, number>) {
  return Object.fromEntries(FEATURE_NAMES.map((feature) => [feature, round(Math.max(std(rows.map((row) => row[feature]), means[feature]), 0.0001), 6)]));
}

function normalizeStatus(status: SystemStatus): RuntimeStatus {
  return {
    ...status,
    model: requireRuntimeModel(status),
  };
}

function requireRuntimeModel(status: SystemStatus): RuntimeModel {
  const model = status.model as RuntimeModel;
  if (!model.weights || !model.means || !model.stds || !model.reference_profile || model.intercept === undefined) {
    throw new Error("Firebase model state is incomplete. Refresh or reinitialize the workspace.");
  }
  return model;
}

function emptyDrift(threshold: number): DriftPayload {
  return {
    score: 0,
    max_score: 0,
    threshold,
    detected: false,
    drifted_columns: [],
    feature_scores: Object.fromEntries(FEATURE_NAMES.map((feature) => [feature, 0])),
  };
}

function accuracyScore(labels: number[], predictions: number[]) {
  return labels.filter((label, index) => label === predictions[index]).length / Math.max(labels.length, 1);
}

function f1Score(labels: number[], predictions: number[]) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  labels.forEach((label, index) => {
    if (label === 1 && predictions[index] === 1) tp += 1;
    if (label === 0 && predictions[index] === 1) fp += 1;
    if (label === 1 && predictions[index] === 0) fn += 1;
  });
  return (2 * tp) / Math.max(2 * tp + fp + fn, 1);
}

function rocAuc(labels: number[], probabilities: number[]) {
  const positives = labels.filter((label) => label === 1).length;
  const negatives = labels.length - positives;
  if (!positives || !negatives) return 0.5;
  const ranked = probabilities
    .map((probability, index) => ({ probability, label: labels[index] }))
    .sort((a, b) => a.probability - b.probability);
  const rankSum = ranked.reduce((total, item, index) => total + (item.label === 1 ? index + 1 : 0), 0);
  return (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

function histogram(values: number[], edges: number[]) {
  const counts = new Array(edges.length - 1).fill(0);
  for (const value of values) {
    let bucket = counts.length - 1;
    for (let index = 0; index < edges.length - 1; index += 1) {
      if (value <= edges[index + 1]) {
        bucket = index;
        break;
      }
    }
    counts[bucket] += 1;
  }
  const total = Math.max(values.length, 1);
  return counts.map((count) => Math.max(count / total, 0.000001));
}

function populationStabilityIndex(expected: number[], actual: number[]) {
  return expected.reduce((total, expectedValue, index) => {
    const actualValue = Math.max(actual[index] ?? 0.000001, 0.000001);
    const safeExpected = Math.max(expectedValue, 0.000001);
    return total + (actualValue - safeExpected) * Math.log(actualValue / safeExpected);
  }, 0);
}

function ensureEdges(edges: number[]) {
  const safe = edges.map((edge) => round(edge, 6));
  for (let index = 1; index < safe.length; index += 1) {
    if (safe[index] <= safe[index - 1]) safe[index] = safe[index - 1] + 0.0001;
  }
  safe[0] -= 0.0001;
  safe[safe.length - 1] += 0.0001;
  return safe;
}

function quantile(sorted: number[], q: number) {
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower] ?? 0;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function clipFeatures(row: PredictionInput) {
  row.ad_spend = clamp(row.ad_spend, 0, 500);
  row.discount_rate = clamp(row.discount_rate, 0, 0.8);
  row.search_index = clamp(row.search_index, 0, 120);
  row.social_sentiment = clamp(row.social_sentiment, -1, 1);
  row.seasonality = clamp(row.seasonality, 0, 1);
  row.inventory_pressure = clamp(row.inventory_pressure, 0, 1);
  row.competitor_price_index = clamp(row.competitor_price_index, 0.5, 1.8);
}

function scaleFeature(value: number, meanValue: number, stdValue: number) {
  return (value - meanValue) / Math.max(stdValue, 0.0001);
}

function createRng(seed: number) {
  let state = Math.max(1, Math.floor(seed) % 2147483647);
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function normal(rng: () => number, meanValue: number, stdValue: number) {
  const u1 = Math.max(rng(), 0.000001);
  const u2 = rng();
  return meanValue + stdValue * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-clamp(value, -35, 35)));
}

function mean(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1);
}

function std(values: number[], meanValue: number) {
  const variance = values.reduce((total, value) => total + (value - meanValue) ** 2, 0) / Math.max(values.length, 1);
  return Math.sqrt(variance);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, places: number) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function compactTimestamp(date: Date) {
  return date.toISOString().replace(/\D/g, "").slice(0, 14);
}
