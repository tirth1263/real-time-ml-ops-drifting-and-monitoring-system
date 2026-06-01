import { useCallback, useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { getStatus } from "./lib/api";
import type { SystemStatus } from "./lib/types";
import { Dashboard } from "./pages/Dashboard";
import { DriftLab } from "./pages/DriftLab";
import { Experiments } from "./pages/Experiments";
import { Operations } from "./pages/Operations";
import { Predictions } from "./pages/Predictions";

export default function App() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await getStatus();
      setStatus(next);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to reach the FastAPI backend.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <Shell status={status} error={error} onRefresh={refresh} refreshing={refreshing}>
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
