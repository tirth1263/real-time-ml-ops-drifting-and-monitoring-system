from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from app.schemas import FEATURE_NAMES


def _psi_for_column(reference: pd.Series, current: pd.Series, bins: int = 10) -> float:
    reference = pd.to_numeric(reference, errors="coerce").dropna()
    current = pd.to_numeric(current, errors="coerce").dropna()
    if reference.empty or current.empty:
        return 0.0

    quantiles = np.linspace(0, 1, bins + 1)
    edges = np.unique(np.quantile(reference, quantiles))
    if len(edges) < 3:
        edges = np.linspace(reference.min(), reference.max() + 1e-6, bins + 1)

    expected, _ = np.histogram(reference, bins=edges)
    actual, _ = np.histogram(current, bins=edges)

    expected_pct = np.clip(expected / max(expected.sum(), 1), 1e-6, None)
    actual_pct = np.clip(actual / max(actual.sum(), 1), 1e-6, None)
    return float(np.sum((actual_pct - expected_pct) * np.log(actual_pct / expected_pct)))


class DriftAnalyzer:
    def __init__(self, threshold: float) -> None:
        self.threshold = threshold

    def analyze(self, reference: pd.DataFrame, current: pd.DataFrame) -> dict[str, Any]:
        scores = {
            column: round(_psi_for_column(reference[column], current[column]), 4)
            for column in FEATURE_NAMES
        }
        max_score = max(scores.values()) if scores else 0.0
        mean_score = float(np.mean(list(scores.values()))) if scores else 0.0
        drifted_columns = [column for column, score in scores.items() if score >= self.threshold]

        return {
            "score": round(mean_score, 4),
            "max_score": round(max_score, 4),
            "threshold": self.threshold,
            "detected": bool(drifted_columns or mean_score >= self.threshold),
            "drifted_columns": drifted_columns,
            "feature_scores": scores,
        }

    def save_report(self, reference: pd.DataFrame, current: pd.DataFrame, report_dir: Path) -> Path:
        report_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        report_path = report_dir / f"drift-report-{timestamp}.html"

        try:
            from evidently import DataDefinition, Dataset, Report
            from evidently.presets import DataDriftPreset

            data_definition = DataDefinition(numerical_columns=FEATURE_NAMES)
            reference_dataset = Dataset.from_pandas(
                reference[FEATURE_NAMES],
                data_definition=data_definition,
            )
            current_dataset = Dataset.from_pandas(
                current[FEATURE_NAMES],
                data_definition=data_definition,
            )
            snapshot = Report([DataDriftPreset()]).run(current_dataset, reference_dataset)
            snapshot.save_html(str(report_path))
            return report_path
        except Exception:
            analysis = self.analyze(reference, current)
            rows = "\n".join(
                f"<tr><td>{feature}</td><td>{score:.4f}</td><td>{'Drift' if score >= self.threshold else 'Stable'}</td></tr>"
                for feature, score in analysis["feature_scores"].items()
            )
            html = f"""
            <!doctype html>
            <html lang="en">
            <head>
              <meta charset="utf-8" />
              <title>Drift Report</title>
              <style>
                body {{ background:#0a0d12; color:#edf2f7; font-family:Inter,Arial,sans-serif; padding:32px; }}
                table {{ border-collapse:collapse; width:100%; margin-top:24px; }}
                td, th {{ border-bottom:1px solid #243244; padding:12px; text-align:left; }}
                .flag {{ color:#55f0b3; }}
              </style>
            </head>
            <body>
              <h1>Data Drift Report</h1>
              <p>Generated {datetime.now(timezone.utc).isoformat()}</p>
              <p>Aggregate PSI score: <strong class="flag">{analysis["score"]}</strong></p>
              <table>
                <thead><tr><th>Feature</th><th>PSI Score</th><th>Status</th></tr></thead>
                <tbody>{rows}</tbody>
              </table>
            </body>
            </html>
            """
            report_path.write_text(html, encoding="utf-8")
            return report_path
