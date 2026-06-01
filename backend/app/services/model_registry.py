from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from typing import Any

import joblib
import mlflow
import mlflow.sklearn
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from app.config import settings
from app.prometheus_metrics import MODEL_VERSION, RETRAINING_TOTAL
from app.schemas import FEATURE_NAMES


@dataclass
class TrainingResult:
    version: str
    trained_at: str
    accuracy: float
    f1: float
    roc_auc: float
    rows: int
    reason: str
    latency_ms: float


class ModelRegistry:
    def __init__(self, artifact_dir: Path) -> None:
        self.artifact_dir = artifact_dir
        self.model_path = artifact_dir / "model.joblib"
        self.pipeline: Pipeline | None = None
        self.version = "untrained"
        self.trained_at = ""
        self.training_metrics: dict[str, Any] = {}
        self.reason = "startup"

    def load(self) -> bool:
        if not self.model_path.exists():
            return False

        payload = joblib.load(self.model_path)
        self.pipeline = payload["pipeline"]
        self.version = payload["version"]
        self.trained_at = payload["trained_at"]
        self.training_metrics = payload["metrics"]
        self.reason = payload.get("reason", "loaded")
        MODEL_VERSION.set(_timestamp_from_version(self.version))
        return True

    def train(self, data: pd.DataFrame, reason: str) -> TrainingResult:
        started = perf_counter()
        clean = data.dropna(subset=FEATURE_NAMES + ["purchased"]).copy()
        x = clean[FEATURE_NAMES]
        y = clean["purchased"].astype(int)

        stratify = y if y.nunique() > 1 and y.value_counts().min() > 1 else None
        x_train, x_test, y_train, y_test = train_test_split(
            x,
            y,
            test_size=0.22,
            random_state=42,
            stratify=stratify,
        )

        pipeline = Pipeline(
            steps=[
                ("scaler", StandardScaler()),
                ("classifier", LogisticRegression(max_iter=800, class_weight="balanced")),
            ]
        )
        pipeline.fit(x_train, y_train)
        predictions = pipeline.predict(x_test)
        probabilities = pipeline.predict_proba(x_test)[:, 1]

        accuracy = float(accuracy_score(y_test, predictions))
        f1 = float(f1_score(y_test, predictions, zero_division=0))
        try:
            roc_auc = float(roc_auc_score(y_test, probabilities))
        except ValueError:
            roc_auc = 0.0

        now = datetime.now(timezone.utc)
        version = f"v{now.strftime('%Y%m%d%H%M%S')}"
        latency_ms = (perf_counter() - started) * 1000
        result = TrainingResult(
            version=version,
            trained_at=now.isoformat(),
            accuracy=round(accuracy, 4),
            f1=round(f1, 4),
            roc_auc=round(roc_auc, 4),
            rows=int(len(clean)),
            reason=reason,
            latency_ms=round(latency_ms, 2),
        )

        self.pipeline = pipeline
        self.version = version
        self.trained_at = result.trained_at
        self.training_metrics = {
            "accuracy": result.accuracy,
            "f1": result.f1,
            "roc_auc": result.roc_auc,
            "rows": result.rows,
            "latency_ms": result.latency_ms,
        }
        self.reason = reason
        self.artifact_dir.mkdir(parents=True, exist_ok=True)
        joblib.dump(
            {
                "pipeline": pipeline,
                "version": version,
                "trained_at": result.trained_at,
                "metrics": self.training_metrics,
                "reason": reason,
            },
            self.model_path,
        )

        self._log_to_mlflow(result, pipeline)
        RETRAINING_TOTAL.labels(reason=reason).inc()
        MODEL_VERSION.set(_timestamp_from_version(version))
        return result

    def predict(self, frame: pd.DataFrame) -> tuple[int, float]:
        if self.pipeline is None:
            raise RuntimeError("Model is not trained.")
        probability = float(self.pipeline.predict_proba(frame[FEATURE_NAMES])[:, 1][0])
        return int(probability >= 0.5), probability

    def predict_batch(self, frame: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
        if self.pipeline is None:
            raise RuntimeError("Model is not trained.")
        probabilities = pd.Series(self.pipeline.predict_proba(frame[FEATURE_NAMES])[:, 1], index=frame.index)
        predictions = (probabilities >= 0.5).astype(int)
        return predictions, probabilities

    def describe(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "trained_at": self.trained_at,
            "training_metrics": self.training_metrics,
            "last_training_reason": self.reason,
        }

    def _log_to_mlflow(self, result: TrainingResult, pipeline: Pipeline) -> None:
        try:
            mlflow.set_tracking_uri(settings.mlflow_tracking_uri)
            mlflow.set_experiment("real-time-mlops-drift-monitor")
            with mlflow.start_run(run_name=f"{result.version}-{result.reason}"):
                mlflow.log_param("reason", result.reason)
                mlflow.log_param("rows", result.rows)
                mlflow.log_metric("accuracy", result.accuracy)
                mlflow.log_metric("f1", result.f1)
                mlflow.log_metric("roc_auc", result.roc_auc)
                mlflow.log_metric("training_latency_ms", result.latency_ms)
                mlflow.sklearn.log_model(pipeline, artifact_path="model")
        except Exception:
            pass


def _timestamp_from_version(version: str) -> float:
    try:
        return datetime.strptime(version.removeprefix("v"), "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc).timestamp()
    except ValueError:
        return 0.0
