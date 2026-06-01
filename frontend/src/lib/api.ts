import type { PredictionInput, PredictionResponse, Scenario, SimulationResponse, SystemStatus } from "./types";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function getStatus() {
  return request<SystemStatus>("/api/status");
}

export function simulateTraffic(payload: {
  scenario: Scenario;
  batch_size: number;
  drift_intensity: number;
  trigger_retrain: boolean;
}) {
  return request<SimulationResponse>("/api/traffic/simulate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function predict(payload: PredictionInput) {
  return request<PredictionResponse>("/api/predict", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function retrain(reason: string) {
  return request("/api/retrain", {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function updateSettings(payload: {
  accuracy_threshold?: number;
  drift_score_threshold?: number;
  auto_retrain_enabled?: boolean;
}) {
  return request<SystemStatus["settings"]>("/api/settings", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function driftReportUrl() {
  return `${API_BASE_URL}/api/drift/report`;
}
