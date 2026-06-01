from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _as_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _as_float(value: str | None, default: float) -> float:
    if value is None:
        return default
    try:
        return float(value)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    app_name: str = "Real-Time MLOps Drift Monitor"
    root_dir: Path = Path(__file__).resolve().parents[2]
    artifact_dir: Path = Path(os.getenv("ARTIFACT_DIR", "artifacts"))
    report_dir: Path = Path(os.getenv("REPORT_DIR", "reports"))
    mlflow_tracking_uri: str = os.getenv("MLFLOW_TRACKING_URI", "file:./mlruns")
    accuracy_threshold: float = _as_float(os.getenv("MODEL_ACCURACY_THRESHOLD"), 0.82)
    drift_score_threshold: float = _as_float(os.getenv("DRIFT_SCORE_THRESHOLD"), 0.18)
    auto_retrain_enabled: bool = _as_bool(os.getenv("AUTO_RETRAIN_ENABLED"), True)

    def ensure_dirs(self) -> None:
        self.artifact_dir.mkdir(parents=True, exist_ok=True)
        self.report_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()
