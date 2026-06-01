import { doc, getDoc, setDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadString } from "firebase/storage";
import { currentUser, firebaseConfig, firestore, storage } from "./firebase";
import {
  createInitialStatus,
  predictWithStatus,
  retrainWithStatus,
  simulateWithStatus,
  updateStatusSettings,
} from "./mlopsEngine";
import type { PredictionInput, PredictionResponse, Scenario, SimulationResponse, SystemStatus } from "./types";

let lastStatusCache: SystemStatus | null = null;

export async function getStatus() {
  const uid = requireUid();
  const status = await ensureStatus(uid);
  lastStatusCache = status;
  return status;
}

export async function simulateTraffic(payload: {
  scenario: Scenario;
  batch_size: number;
  drift_intensity: number;
  trigger_retrain: boolean;
}) {
  const uid = requireUid();
  const status = await ensureStatus(uid);
  const result = simulateWithStatus(status, payload.scenario, payload.batch_size, payload.drift_intensity, payload.trigger_retrain);
  const reportPath = `users/${uid}/reports/latest-drift-report.html`;
  const reportUpload = await tryUploadHtml(reportPath, result.reportHtml);
  let nextStatus: SystemStatus = {
    ...result.status,
    drift_report_url: reportUpload.ok ? reportUpload.url : status.drift_report_url,
  };
  nextStatus = applyUploadState(nextStatus, reportUpload, "Drift report upload");

  if (result.modelArtifact) {
    const modelUpload = await tryUploadArtifact(`users/${uid}/models/${result.status.model.version}.json`, result.modelArtifact);
    nextStatus = applyUploadState(nextStatus, modelUpload, "Auto-retrained model artifact upload");
  }

  await saveStatus(uid, nextStatus);
  lastStatusCache = nextStatus;
  return {
    ...result.response,
    model: nextStatus.model,
  } satisfies SimulationResponse;
}

export async function predict(payload: PredictionInput): Promise<PredictionResponse> {
  const uid = requireUid();
  const status = await ensureStatus(uid);
  return predictWithStatus(status, payload);
}

export async function retrain(reason: string) {
  const uid = requireUid();
  const status = await ensureStatus(uid);
  const result = retrainWithStatus(status, reason);
  const modelUpload = await tryUploadArtifact(`users/${uid}/models/${result.run.version}.json`, result.modelArtifact);
  const nextStatus = applyUploadState(result.status, modelUpload, "Manual model artifact upload");
  await saveStatus(uid, nextStatus);
  lastStatusCache = nextStatus;
  return result.run;
}

export async function updateSettings(payload: {
  accuracy_threshold?: number;
  drift_score_threshold?: number;
  auto_retrain_enabled?: boolean;
}) {
  const uid = requireUid();
  const status = await ensureStatus(uid);
  const nextStatus = updateStatusSettings(status, payload);
  await saveStatus(uid, nextStatus);
  lastStatusCache = nextStatus;
  return nextStatus.settings;
}

export function driftReportUrl() {
  return (
    lastStatusCache?.drift_report_url ??
    `https://console.firebase.google.com/project/${firebaseConfig.projectId}/storage/${firebaseConfig.projectId}.firebasestorage.app/files`
  );
}

export function firebaseConsoleUrl(section: "auth" | "firestore" | "storage" | "hosting" = "hosting") {
  const route = {
    auth: "authentication/users",
    firestore: "firestore/databases/-default-/data",
    storage: `storage/${firebaseConfig.projectId}.firebasestorage.app/files`,
    hosting: "hosting/sites",
  }[section];
  return `https://console.firebase.google.com/project/${firebaseConfig.projectId}/${route}`;
}

async function ensureStatus(uid: string): Promise<SystemStatus> {
  const reference = runtimeDoc(uid);
  const snapshot = await getDoc(reference);
  if (snapshot.exists()) {
    return snapshot.data() as SystemStatus;
  }

  const initial = createInitialStatus(uid);
  const modelUpload = await tryUploadArtifact(`users/${uid}/models/${initial.model.version}.json`, JSON.stringify(initial.model, null, 2));
  const nextStatus = applyUploadState(initial, modelUpload, "Initial model artifact upload");
  await saveStatus(uid, nextStatus);
  return nextStatus;
}

async function saveStatus(uid: string, status: SystemStatus) {
  await setDoc(runtimeDoc(uid), cleanJson(status), { merge: false });
}

function runtimeDoc(uid: string) {
  return doc(firestore, "users", uid, "mlops", "runtime");
}

async function uploadHtml(path: string, html: string) {
  const fileRef = ref(storage, path);
  await uploadString(fileRef, html, "raw", {
    contentType: "text/html",
  });
  return getDownloadURL(fileRef);
}

async function uploadArtifact(path: string, json: string) {
  const fileRef = ref(storage, path);
  await uploadString(fileRef, json, "raw", {
    contentType: "application/json",
  });
  return getDownloadURL(fileRef);
}

async function tryUploadHtml(path: string, html: string) {
  try {
    return { ok: true, url: await uploadHtml(path, html) } as const;
  } catch (caught) {
    return { ok: false, message: storageErrorMessage(caught) } as const;
  }
}

async function tryUploadArtifact(path: string, json: string) {
  try {
    return { ok: true, url: await uploadArtifact(path, json) } as const;
  } catch (caught) {
    return { ok: false, message: storageErrorMessage(caught) } as const;
  }
}

function applyUploadState(
  status: SystemStatus,
  upload: { ok: true; url: string } | { ok: false; message: string },
  context: string,
): SystemStatus {
  if (upload.ok) {
    return {
      ...status,
      storage_status: "ready",
      storage_error: undefined,
    };
  }

  return {
    ...status,
    storage_status: "setup_required",
    storage_error: upload.message,
    events: [
      {
        type: "storage_setup_required",
        message: `${context} is waiting for Firebase Storage setup: ${upload.message}`,
        timestamp: new Date().toISOString(),
      },
      ...status.events,
    ].slice(0, 50),
  };
}

function requireUid() {
  const user = currentUser();
  if (!user) {
    throw new Error("Sign in with Google before using the Firebase MLOps workspace.");
  }
  return user.uid;
}

function cleanJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function storageErrorMessage(caught: unknown) {
  if (caught instanceof Error) return caught.message;
  return "Firebase Storage is not ready for this project yet.";
}
