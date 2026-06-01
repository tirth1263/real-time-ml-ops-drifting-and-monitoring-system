import type { ReactNode } from "react";

type Tone = "good" | "warn" | "bad" | "neutral";

export function StatusPill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}
