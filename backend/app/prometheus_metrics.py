from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram

HTTP_REQUESTS_TOTAL = Counter(
    "mlops_http_requests_total",
    "Total HTTP requests served by the model API.",
    ["method", "path", "status"],
)

HTTP_REQUEST_LATENCY = Histogram(
    "mlops_http_request_latency_seconds",
    "HTTP request latency in seconds.",
    ["method", "path"],
)

PREDICTIONS_TOTAL = Counter(
    "mlops_predictions_total",
    "Total prediction requests.",
    ["model_version", "prediction"],
)

SIMULATED_BATCHES_TOTAL = Counter(
    "mlops_simulated_batches_total",
    "Synthetic traffic batches processed by scenario.",
    ["scenario"],
)

RETRAINING_TOTAL = Counter(
    "mlops_retraining_total",
    "Model retraining runs.",
    ["reason"],
)

MODEL_ACCURACY = Gauge(
    "mlops_model_accuracy",
    "Latest observed model accuracy from monitored traffic.",
)

MODEL_F1 = Gauge(
    "mlops_model_f1",
    "Latest observed F1 score from monitored traffic.",
)

DATA_DRIFT_SCORE = Gauge(
    "mlops_data_drift_score",
    "Latest aggregate data drift score.",
)

ACTIVE_ALERTS = Gauge(
    "mlops_active_alerts",
    "Number of active unresolved alerts.",
)

MODEL_VERSION = Gauge(
    "mlops_model_version_timestamp",
    "Unix timestamp for the currently loaded model version.",
)
