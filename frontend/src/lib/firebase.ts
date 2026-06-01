import { getAnalytics, isSupported, type Analytics } from "firebase/analytics";
import { getApps, initializeApp, type FirebaseApp } from "firebase/app";

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "AIzaSyCwGgcp0OhJGYAxBNyL2Xbp1WPjbTlOwCY",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "ml-ops-drift-monitoring-system.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "ml-ops-drift-monitoring-system",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "ml-ops-drift-monitoring-system.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "851071704392",
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "1:851071704392:web:384be4c6f5ebb9c8eee77d",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID ?? "G-4JPZ96WDSD",
};

export const firebaseApp: FirebaseApp = getApps()[0] ?? initializeApp(firebaseConfig);

export const firebaseAnalytics: Promise<Analytics | null> =
  typeof window === "undefined"
    ? Promise.resolve(null)
    : isSupported()
        .then((supported) => (supported ? getAnalytics(firebaseApp) : null))
        .catch(() => null);
