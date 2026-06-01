export type Scenario = "baseline" | "mild_drift" | "severe_drift" | "trend_shift";

export type FeatureScores = Record<string, number>;

export interface DriftPayload {
  score: number;
  max_score: number;
  threshold: number;
  detected: boolean;
  drifted_columns: string[];
  feature_scores: FeatureScores;
}

export interface HistoryPoint {
  timestamp: string;
  scenario: Scenario;
  batch_size: number;
  accuracy: number;
  f1: number;
  drift_score: number;
  drift_detected: boolean;
  model_version: string;
}

export interface AlertItem {
  id: string;
  timestamp: string;
  scenario: string;
  severity: "warning" | "critical";
  status: string;
  message: string;
  model_version: string;
  drifted_columns: string[];
}

export interface EventItem {
  type: string;
  message: string;
  timestamp: string;
}

export interface TrainingRun {
  version: string;
  trained_at: string;
  accuracy: number;
  f1: number;
  roc_auc: number;
  rows: number;
  reason: string;
  latency_ms: number;
}

export interface SystemStatus {
  service: string;
  model: {
    version: string;
    trained_at: string;
    training_metrics: Record<string, number>;
    last_training_reason: string;
    weights?: number[];
    intercept?: number;
    means?: Record<string, number>;
    stds?: Record<string, number>;
    reference_profile?: ReferenceProfile;
  };
  settings: {
    accuracy_threshold: number;
    drift_score_threshold: number;
    auto_retrain_enabled: boolean;
  };
  latest: {
    accuracy: number;
    f1: number;
    drift_score: number;
    drift_detected: boolean;
    scenario: Scenario;
    drift: DriftPayload;
  };
  alerts: AlertItem[];
  active_alert_count: number;
  history: HistoryPoint[];
  events: EventItem[];
  training_runs: TrainingRun[];
  drift_report_available: boolean;
  drift_report_url?: string;
  storage_status?: "ready" | "setup_required";
  storage_error?: string;
  updated_at?: string;
  owner_uid?: string;
}

export interface PredictionInput {
  ad_spend: number;
  discount_rate: number;
  search_index: number;
  social_sentiment: number;
  seasonality: number;
  inventory_pressure: number;
  competitor_price_index: number;
}

export interface PredictionResponse {
  prediction: number;
  label: string;
  confidence: number;
  probability: number;
  model_version: string;
  latency_ms: number;
}

export interface SimulationResponse {
  scenario: Scenario;
  batch_size: number;
  accuracy: number;
  f1: number;
  drift: DriftPayload;
  alert: AlertItem | null;
  retraining_triggered: boolean;
  retraining: TrainingRun | null;
  model: SystemStatus["model"];
}

export interface ReferenceProfile {
  rows: number;
  features: Record<
    string,
    {
      edges: number[];
      expected: number[];
      mean: number;
      std: number;
    }
  >;
}
