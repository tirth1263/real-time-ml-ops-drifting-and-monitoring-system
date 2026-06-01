from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


FEATURE_NAMES = [
    "ad_spend",
    "discount_rate",
    "search_index",
    "social_sentiment",
    "seasonality",
    "inventory_pressure",
    "competitor_price_index",
]

ScenarioName = Literal["baseline", "mild_drift", "severe_drift", "trend_shift"]


class PredictionInput(BaseModel):
    ad_spend: float = Field(120.0, ge=0, le=500)
    discount_rate: float = Field(0.18, ge=0, le=0.8)
    search_index: float = Field(58.0, ge=0, le=120)
    social_sentiment: float = Field(0.18, ge=-1, le=1)
    seasonality: float = Field(0.62, ge=0, le=1)
    inventory_pressure: float = Field(0.28, ge=0, le=1)
    competitor_price_index: float = Field(1.02, ge=0.5, le=1.8)


class PredictionResponse(BaseModel):
    prediction: int
    label: str
    confidence: float
    probability: float
    model_version: str
    latency_ms: float


class SimulationRequest(BaseModel):
    scenario: ScenarioName = "baseline"
    batch_size: int = Field(350, ge=50, le=5000)
    drift_intensity: float = Field(0.75, ge=0, le=1.5)
    trigger_retrain: bool = True


class RetrainRequest(BaseModel):
    reason: str = Field("manual_retrain", min_length=3, max_length=80)


class SettingsUpdate(BaseModel):
    accuracy_threshold: float | None = Field(default=None, ge=0.5, le=0.99)
    drift_score_threshold: float | None = Field(default=None, ge=0.02, le=1.0)
    auto_retrain_enabled: bool | None = None
