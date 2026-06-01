import { Activity, AlertTriangle, Bot, Gauge, GitBranch, LineChart, RefreshCw, ServerCog, TestTube2 } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import type { SystemStatus } from "../lib/types";
import { StatusPill } from "./StatusPill";

const navItems = [
  { to: "/", label: "Dashboard", icon: Gauge },
  { to: "/drift-lab", label: "Drift Lab", icon: TestTube2 },
  { to: "/predictions", label: "Predictions", icon: Bot },
  { to: "/experiments", label: "Experiments", icon: GitBranch },
  { to: "/operations", label: "Operations", icon: ServerCog },
];

export function Shell({
  children,
  status,
  error,
  onRefresh,
  refreshing,
}: {
  children: ReactNode;
  status: SystemStatus | null;
  error: string | null;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark">
          <div className="brand-glyph">
            <LineChart size={24} />
          </div>
          <div>
            <span>MLOps</span>
            <strong>Drift Monitor</strong>
          </div>
        </div>

        <nav className="nav-list" aria-label="Application navigation">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
              <item.icon size={18} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <StatusPill tone={error ? "bad" : "good"}>{error ? "API offline" : "API online"}</StatusPill>
          <a href="http://localhost:8000/docs" target="_blank" rel="noreferrer">
            FastAPI Docs
          </a>
        </div>
      </aside>

      <div className="content-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Real-time production monitor</p>
            <h1>Model drift command center</h1>
          </div>
          <div className="topbar-actions">
            {status ? (
              <>
                <StatusPill tone={status.active_alert_count > 0 ? "bad" : "good"}>
                  <AlertTriangle size={14} /> {status.active_alert_count} alerts
                </StatusPill>
                <StatusPill tone={status.settings.auto_retrain_enabled ? "good" : "warn"}>
                  <Activity size={14} /> Auto retrain {status.settings.auto_retrain_enabled ? "on" : "off"}
                </StatusPill>
                <StatusPill>{status.model.version}</StatusPill>
              </>
            ) : null}
            <button className="icon-button" onClick={onRefresh} disabled={refreshing} title="Refresh API state" type="button">
              <RefreshCw size={18} className={refreshing ? "spin" : ""} />
            </button>
          </div>
        </header>

        {error ? <div className="connection-banner">{error}</div> : null}
        <main>{children}</main>
      </div>
    </div>
  );
}
