"""JSON file based save / settings persistence."""
from __future__ import annotations

import json
import os
from typing import Any, Dict

from .game_data import DEFAULT_SETTINGS


def _safe_path(saves_dir: str, name: str) -> str:
    if "/" in name or "\\" in name or ".." in name:
        raise ValueError("invalid save name")
    return os.path.join(saves_dir, name)


def load_run(saves_dir: str) -> Dict[str, Any] | None:
    path = _safe_path(saves_dir, "run.json")
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def save_run(saves_dir: str, data: Dict[str, Any]) -> None:
    path = _safe_path(saves_dir, "run.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def clear_run(saves_dir: str) -> None:
    path = _safe_path(saves_dir, "run.json")
    if os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            pass


def load_settings(saves_dir: str) -> Dict[str, Any]:
    path = _safe_path(saves_dir, "settings.json")
    if not os.path.exists(path):
        return dict(DEFAULT_SETTINGS)
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        merged = dict(DEFAULT_SETTINGS)
        merged.update({k: v for k, v in data.items() if k in DEFAULT_SETTINGS})
        return merged
    except (OSError, json.JSONDecodeError):
        return dict(DEFAULT_SETTINGS)


def save_settings(saves_dir: str, data: Dict[str, Any]) -> Dict[str, Any]:
    current = load_settings(saves_dir)
    for k, v in data.items():
        if k in DEFAULT_SETTINGS:
            current[k] = v
    path = _safe_path(saves_dir, "settings.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(current, f, indent=2)
    return current


def append_meta(saves_dir: str, summary: Dict[str, Any]) -> None:
    path = _safe_path(saves_dir, "meta.json")
    existing: Dict[str, Any] = {"runs": [], "best_wave": 0, "total_kills": 0}
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                existing = json.load(f)
        except (OSError, json.JSONDecodeError):
            pass
    existing.setdefault("runs", []).append(summary)
    existing["best_wave"] = max(existing.get("best_wave", 0), summary.get("waves_cleared", 0))
    existing["total_kills"] = existing.get("total_kills", 0) + summary.get("enemies_killed", 0)
    # cap stored runs to last 50
    existing["runs"] = existing["runs"][-50:]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(existing, f, indent=2)
