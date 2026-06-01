from __future__ import annotations

from datetime import datetime, timezone

import numpy as np
import pandas as pd

from app.schemas import FEATURE_NAMES, ScenarioName


def _sigmoid(value: np.ndarray) -> np.ndarray:
    return 1 / (1 + np.exp(-value))


def _clip_frame(frame: pd.DataFrame) -> pd.DataFrame:
    frame["ad_spend"] = frame["ad_spend"].clip(0, 500)
    frame["discount_rate"] = frame["discount_rate"].clip(0, 0.8)
    frame["search_index"] = frame["search_index"].clip(0, 120)
    frame["social_sentiment"] = frame["social_sentiment"].clip(-1, 1)
    frame["seasonality"] = frame["seasonality"].clip(0, 1)
    frame["inventory_pressure"] = frame["inventory_pressure"].clip(0, 1)
    frame["competitor_price_index"] = frame["competitor_price_index"].clip(0.5, 1.8)
    return frame


def _base_features(rng: np.random.Generator, rows: int) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "ad_spend": rng.normal(125, 38, rows),
            "discount_rate": rng.beta(2.3, 7.0, rows) * 0.55,
            "search_index": rng.normal(56, 14, rows),
            "social_sentiment": rng.normal(0.16, 0.26, rows),
            "seasonality": rng.beta(2.2, 2.0, rows),
            "inventory_pressure": rng.beta(2.0, 5.5, rows),
            "competitor_price_index": rng.normal(1.02, 0.09, rows),
        }
    )


def _apply_covariate_shift(
    frame: pd.DataFrame,
    rng: np.random.Generator,
    scenario: ScenarioName,
    intensity: float,
) -> pd.DataFrame:
    if scenario == "baseline":
        return frame

    if scenario == "mild_drift":
        frame["ad_spend"] += 18 * intensity
        frame["search_index"] += 10 * intensity
        frame["social_sentiment"] -= 0.18 * intensity
        frame["competitor_price_index"] += 0.05 * intensity
        frame["inventory_pressure"] += rng.normal(0.05 * intensity, 0.035, len(frame))

    if scenario == "severe_drift":
        frame["ad_spend"] += 58 * intensity
        frame["discount_rate"] += rng.normal(0.12 * intensity, 0.04, len(frame))
        frame["search_index"] += 30 * intensity
        frame["social_sentiment"] -= 0.52 * intensity
        frame["inventory_pressure"] += 0.26 * intensity
        frame["competitor_price_index"] += 0.17 * intensity

    if scenario == "trend_shift":
        frame["ad_spend"] -= 20 * intensity
        frame["discount_rate"] -= 0.08 * intensity
        frame["search_index"] += 24 * intensity
        frame["social_sentiment"] += 0.48 * intensity
        frame["seasonality"] = 0.35 + rng.beta(4.0, 1.8, len(frame)) * 0.62
        frame["competitor_price_index"] += rng.normal(0.04 * intensity, 0.05, len(frame))

    return frame


def _conversion_probability(frame: pd.DataFrame, scenario: ScenarioName, rng: np.random.Generator) -> np.ndarray:
    if scenario in {"severe_drift", "trend_shift"}:
        logit = (
            -2.4
            + 0.0035 * frame["ad_spend"]
            + 1.2 * frame["discount_rate"]
            + 0.042 * frame["search_index"]
            + 2.8 * frame["social_sentiment"]
            + 1.4 * frame["seasonality"]
            - 1.55 * frame["inventory_pressure"]
            - 2.35 * frame["competitor_price_index"]
            + rng.normal(0, 0.35, len(frame))
        )
    else:
        logit = (
            -3.05
            + 0.010 * frame["ad_spend"]
            + 3.7 * frame["discount_rate"]
            + 0.026 * frame["search_index"]
            + 1.35 * frame["social_sentiment"]
            + 1.05 * frame["seasonality"]
            - 0.82 * frame["inventory_pressure"]
            - 1.05 * frame["competitor_price_index"]
            + rng.normal(0, 0.28, len(frame))
        )

    return _sigmoid(logit.to_numpy())


def generate_consumer_batch(
    scenario: ScenarioName = "baseline",
    rows: int = 500,
    drift_intensity: float = 0.75,
    seed: int | None = None,
) -> pd.DataFrame:
    """Create labeled synthetic consumer-trend traffic for serving and retraining."""
    rng = np.random.default_rng(seed)
    intensity = float(np.clip(drift_intensity, 0, 1.5))
    frame = _base_features(rng, rows)
    frame = _apply_covariate_shift(frame, rng, scenario, intensity)
    frame = _clip_frame(frame)

    probabilities = _conversion_probability(frame, scenario, rng)
    labels = rng.binomial(1, probabilities)
    frame["purchased"] = labels
    frame["true_probability"] = probabilities
    frame["scenario"] = scenario
    frame["event_time"] = datetime.now(timezone.utc).isoformat()
    return frame[FEATURE_NAMES + ["purchased", "true_probability", "scenario", "event_time"]]


def prediction_features_from_payload(payload: object) -> pd.DataFrame:
    return pd.DataFrame([{name: getattr(payload, name) for name in FEATURE_NAMES}])
