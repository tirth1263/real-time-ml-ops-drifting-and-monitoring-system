from __future__ import annotations

import argparse

from app.services.data_generator import generate_consumer_batch
from app.services.model_registry import ModelRegistry
from app.config import settings


def main() -> None:
    parser = argparse.ArgumentParser(description="Train a fresh model artifact from synthetic traffic.")
    parser.add_argument("--scenario", default="baseline", choices=["baseline", "mild_drift", "severe_drift", "trend_shift"])
    parser.add_argument("--rows", default=1800, type=int)
    parser.add_argument("--reason", default="script_retrain")
    args = parser.parse_args()

    settings.ensure_dirs()
    data = generate_consumer_batch(args.scenario, rows=args.rows, drift_intensity=1.0, seed=99)
    registry = ModelRegistry(settings.artifact_dir)
    result = registry.train(data, reason=args.reason)
    print(result)


if __name__ == "__main__":
    main()
