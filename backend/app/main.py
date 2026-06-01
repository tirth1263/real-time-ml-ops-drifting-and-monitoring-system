from __future__ import annotations

from time import perf_counter

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from app.config import settings
from app.prometheus_metrics import HTTP_REQUEST_LATENCY, HTTP_REQUESTS_TOTAL
from app.schemas import PredictionInput, PredictionResponse, RetrainRequest, SettingsUpdate, SimulationRequest
from app.services.runtime import MonitoringRuntime

app = FastAPI(
    title=settings.app_name,
    description="Serve, monitor, alert, and retrain a model under synthetic real-time data drift.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

runtime = MonitoringRuntime()


@app.middleware("http")
async def metrics_middleware(request: Request, call_next):
    started = perf_counter()
    response = await call_next(request)
    latency = perf_counter() - started
    path = request.url.path
    HTTP_REQUESTS_TOTAL.labels(request.method, path, str(response.status_code)).inc()
    HTTP_REQUEST_LATENCY.labels(request.method, path).observe(latency)
    return response


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "model_version": runtime.registry.version}


@app.get("/api/status")
def status() -> dict:
    return runtime.status()


@app.post("/api/predict", response_model=PredictionResponse)
def predict(payload: PredictionInput) -> dict:
    return runtime.predict(payload)


@app.post("/api/traffic/simulate")
def simulate_traffic(payload: SimulationRequest) -> dict:
    return runtime.simulate(
        scenario=payload.scenario,
        batch_size=payload.batch_size,
        drift_intensity=payload.drift_intensity,
        trigger_retrain=payload.trigger_retrain,
    )


@app.post("/api/retrain")
def retrain(payload: RetrainRequest) -> dict:
    return runtime.retrain(reason=payload.reason)


@app.put("/api/settings")
def update_settings(payload: SettingsUpdate) -> dict:
    return runtime.update_settings(
        accuracy_threshold=payload.accuracy_threshold,
        drift_score_threshold=payload.drift_score_threshold,
        auto_retrain_enabled=payload.auto_retrain_enabled,
    )


@app.get("/api/drift/report")
def drift_report() -> FileResponse:
    report_path = runtime.report_path()
    return FileResponse(report_path, filename=report_path.name, media_type="text/html")


@app.get("/metrics")
def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
