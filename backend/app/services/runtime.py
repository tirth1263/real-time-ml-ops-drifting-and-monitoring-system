from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from time import perf_counter
from typing import Any

import pandas as pd
from sklearn.metrics import accuracy_score, f1_score

from app.config import settings
from app.prometheus_metrics import ACTIVE_ALERTS, DATA_DRIFT_SCORE, MODEL_ACCURACY, MODEL_F1, PREDICTIONS_TOTAL, SIMULATED_BATCHES_TOTAL
from app.schemas import PredictionInput, ScenarioName
from app.services.data_generator import generate_consumer_batch, prediction_features_from_payload
from app.services.drift import DriftAnalyzer
from app.services.model_registry import ModelRegistry, TrainingResult


class MonitoringRuntime:
    def __init__(self) -> None:
        settings.ensure_dirs()
        self.lock = RLock()
        self.registry = ModelRegistry(settings.artifact_dir)
        self.reference_data = generate_consumer_batch("baseline", rows=1600, drift_intensity=0, seed=7)
        self.current_data = self.reference_data.tail(350).copy()
        self.accuracy_threshold = settings.accuracy_threshold
        self.drift_score_threshold = settings.drift_score_threshold
        self.auto_retrain_enabled = settings.auto_retrain_enabled
        self.drift_analyzer = DriftAnalyzer(self.drift_score_threshold)
        self.history: deque[dict[str, Any]] = deque(maxlen=40)
        self.alerts: deque[dict[str, Any]] = deque(maxlen=30)
        self.events: deque[dict[str, Any]] = deque(maxlen=50)
        self.training_runs: deque[dict[str, Any]] = deque(maxlen=20)
        self.latest_metrics = {
            "accuracy": 0.0,
            "f1": 0.0,
            "drift_score": 0.0,
            "drift_detected": False,
            "scenario": "baseline",
        }
        self.latest_report_path: Path | None = None
        self._bootstrap()

    def _bootstrap(self) -> None:
        loaded = self.registry.load()
        if loaded:
            self._record_event("model_loaded", f"Loaded model {self.registry.version} from artifact storage.")
        else:
            result = self.registry.train(self.reference_data, reason="initial_baseline_training")
            self.training_runs.appendleft(result.__dict__)
            self._record_event("model_trained", f"Trained baseline model {result.version}.")
        MODEL_ACCURACY.set(self.registry.training_metrics.get("accuracy", 0))
        MODEL_F1.set(self.registry.training_metrics.get("f1", 0))
        ACTIVE_ALERTS.set(0)

    def predict(self, payload: PredictionInput) -> dict[str, Any]:
        started = perf_counter()
        frame = prediction_features_from_payload(payload)
        prediction, probability = self.registry.predict(frame)
        latency_ms = (perf_counter() - started) * 1000
        PREDICTIONS_TOTAL.labels(model_version=self.registry.version, prediction=str(prediction)).inc()
        return {
            "prediction": prediction,
            "label": "Likely to purchase" if prediction == 1 else "Unlikely to purchase",
            "confidence": round(max(probability, 1 - probability), 4),
            "probability": round(probability, 4),
            "model_version": self.registry.version,
            "latency_ms": round(latency_ms, 2),
        }

    def simulate(
        self,
        scenario: ScenarioName,
        batch_size: int,
        drift_intensity: float,
        trigger_retrain: bool,
    ) -> dict[str, Any]:
        with self.lock:
            batch = generate_consumer_batch(scenario, rows=batch_size, drift_intensity=drift_intensity)
            predictions, probabilities = self.registry.predict_batch(batch)
            batch["prediction"] = predictions
            batch["prediction_probability"] = probabilities

            accuracy = float(accuracy_score(batch["purchased"], predictions))
            f1 = float(f1_score(batch["purchased"], predictions, zero_division=0))
            drift = self.drift_analyzer.analyze(self.reference_data, batch)
            should_alert = accuracy < self.accuracy_threshold or drift["score"] >= self.drift_score_threshold
            should_retrain = trigger_retrain and self.auto_retrain_enabled and accuracy < self.accuracy_threshold

            self.current_data = batch.copy()
            self.latest_metrics = {
                "accuracy": round(accuracy, 4),
                "f1": round(f1, 4),
                "drift_score": drift["score"],
                "drift_detected": drift["detected"],
                "scenario": scenario,
            }
            self.history.append(
                {
                    "timestamp": _now(),
                    "scenario": scenario,
                    "batch_size": batch_size,
                    "accuracy": round(accuracy, 4),
                    "f1": round(f1, 4),
                    "drift_score": drift["score"],
                    "drift_detected": drift["detected"],
                    "model_version": self.registry.version,
                }
            )
            MODEL_ACCURACY.set(accuracy)
            MODEL_F1.set(f1)
            DATA_DRIFT_SCORE.set(drift["score"])
            SIMULATED_BATCHES_TOTAL.labels(scenario=scenario).inc()

            alert = None
            if should_alert:
                alert = self._create_alert(accuracy, drift, scenario)

            retrain_result = None
            if should_retrain:
                retrain_result = self._retrain_with_current_data(reason=f"auto_retrain_after_{scenario}")

            self.latest_report_path = self.drift_analyzer.save_report(self.reference_data, batch, settings.report_dir)
            return {
                "scenario": scenario,
                "batch_size": batch_size,
                "accuracy": round(accuracy, 4),
                "f1": round(f1, 4),
                "drift": drift,
                "alert": alert,
                "retraining_triggered": retrain_result is not None,
                "retraining": retrain_result.__dict__ if retrain_result else None,
                "model": self.registry.describe(),
            }

    def retrain(self, reason: str) -> dict[str, Any]:
        with self.lock:
            result = self._retrain_with_current_data(reason=reason)
            return result.__dict__

    def update_settings(
        self,
        accuracy_threshold: float | None,
        drift_score_threshold: float | None,
        auto_retrain_enabled: bool | None,
    ) -> dict[str, Any]:
        with self.lock:
            if accuracy_threshold is not None:
                self.accuracy_threshold = accuracy_threshold
            if drift_score_threshold is not None:
                self.drift_score_threshold = drift_score_threshold
                self.drift_analyzer.threshold = drift_score_threshold
            if auto_retrain_enabled is not None:
                self.auto_retrain_enabled = auto_retrain_enabled
            self._record_event("settings_updated", "Monitoring thresholds were updated from the control center.")
            return self.settings()

    def settings(self) -> dict[str, Any]:
        return {
            "accuracy_threshold": self.accuracy_threshold,
            "drift_score_threshold": self.drift_score_threshold,
            "auto_retrain_enabled": self.auto_retrain_enabled,
        }

    def status(self) -> dict[str, Any]:
        with self.lock:
            drift = self.drift_analyzer.analyze(self.reference_data, self.current_data)
            return {
                "service": "online",
                "model": self.registry.describe(),
                "settings": self.settings(),
                "latest": {
                    **self.latest_metrics,
                    "drift": drift,
                },
                "alerts": list(self.alerts),
                "active_alert_count": len([alert for alert in self.alerts if alert["status"] == "active"]),
                "history": list(self.history),
                "events": list(self.events),
                "training_runs": list(self.training_runs),
                "drift_report_available": self.latest_report_path is not None,
            }

    def report_path(self) -> Path:
        with self.lock:
            if self.latest_report_path is None or not self.latest_report_path.exists():
                self.latest_report_path = self.drift_analyzer.save_report(
                    self.reference_data,
                    self.current_data,
                    settings.report_dir,
                )
            return self.latest_report_path

    def _retrain_with_current_data(self, reason: str) -> TrainingResult:
        reference_sample = self.reference_data.sample(min(len(self.reference_data), 900), random_state=11)
        training_frame = pd.concat([reference_sample, self.current_data], ignore_index=True)
        result = self.registry.train(training_frame, reason=reason)
        self.reference_data = training_frame.tail(min(len(training_frame), 1600)).copy()
        self.training_runs.appendleft(result.__dict__)
        self._record_event("model_retrained", f"Model {result.version} trained because: {reason}.")
        MODEL_ACCURACY.set(result.accuracy)
        MODEL_F1.set(result.f1)
        return result

    def _create_alert(self, accuracy: float, drift: dict[str, Any], scenario: str) -> dict[str, Any]:
        reasons: list[str] = []
        if accuracy < self.accuracy_threshold:
            reasons.append(f"accuracy {accuracy:.3f} below threshold {self.accuracy_threshold:.3f}")
        if drift["score"] >= self.drift_score_threshold:
            reasons.append(f"drift score {drift['score']:.3f} above threshold {self.drift_score_threshold:.3f}")
        alert = {
            "id": f"alert-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}",
            "timestamp": _now(),
            "scenario": scenario,
            "severity": "critical" if accuracy < self.accuracy_threshold else "warning",
            "status": "active",
            "message": "; ".join(reasons),
            "model_version": self.registry.version,
            "drifted_columns": drift["drifted_columns"],
        }
        self.alerts.appendleft(alert)
        ACTIVE_ALERTS.set(len([item for item in self.alerts if item["status"] == "active"]))
        self._record_event("alert_created", alert["message"])
        return alert

    def _record_event(self, event_type: str, message: str) -> None:
        self.events.appendleft(
            {
                "type": event_type,
                "message": message,
                "timestamp": _now(),
            }
        )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
