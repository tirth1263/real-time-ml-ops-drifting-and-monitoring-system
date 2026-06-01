from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health_reports_model_version():
    response = client.get("/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["model_version"].startswith("v")


def test_prediction_endpoint_returns_probability():
    response = client.post(
        "/api/predict",
        json={
            "ad_spend": 140,
            "discount_rate": 0.22,
            "search_index": 64,
            "social_sentiment": 0.2,
            "seasonality": 0.7,
            "inventory_pressure": 0.18,
            "competitor_price_index": 1.01,
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert 0 <= payload["probability"] <= 1
    assert payload["prediction"] in [0, 1]


def test_severe_drift_simulation_produces_monitoring_payload():
    response = client.post(
        "/api/traffic/simulate",
        json={
            "scenario": "severe_drift",
            "batch_size": 120,
            "drift_intensity": 1.0,
            "trigger_retrain": False,
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["scenario"] == "severe_drift"
    assert "accuracy" in payload
    assert "drift" in payload
    assert payload["drift"]["feature_scores"]
