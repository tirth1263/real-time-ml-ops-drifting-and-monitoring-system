import { onAuthStateChanged, type User } from "firebase/auth";
import { useCallback, useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { AuthGate } from "./components/AuthGate";
import { Shell } from "./components/Shell";
import { getStatus } from "./lib/api";
import { firebaseAuth } from "./lib/firebase";
import type { SystemStatus } from "./lib/types";
import { Dashboard } from "./pages/Dashboard";
import { DriftLab } from "./pages/DriftLab";
import { Experiments } from "./pages/Experiments";
import { Operations } from "./pages/Operations";
import { Predictions } from "./pages/Predictions";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    setRefreshing(true);
    try {
      const next = await getStatus();
      setStatus(next);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load the Firebase MLOps workspace.");
    } finally {
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    return onAuthStateChanged(firebaseAuth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) {
        setStatus(null);
        setError(null);
      }
    });
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [refresh, user]);

  if (!authReady) {
    return (
      <main className="auth-stage">
        <div className="empty-state">Loading Firebase workspace...</div>
      </main>
    );
  }

  if (!user) {
    return <AuthGate />;
  }

  return (
    <Shell status={status} error={error} onRefresh={refresh} refreshing={refreshing} user={user}>
      <Routes>
        <Route path="/" element={<Dashboard status={status} refresh={refresh} />} />
        <Route path="/drift-lab" element={<DriftLab status={status} refresh={refresh} />} />
        <Route path="/predictions" element={<Predictions status={status} />} />
        <Route path="/experiments" element={<Experiments status={status} refresh={refresh} />} />
        <Route path="/operations" element={<Operations status={status} refresh={refresh} />} />
      </Routes>
    </Shell>
  );
}
