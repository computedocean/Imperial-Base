"""Exit 1 when the built frontend (frontend/dist) is missing or older than its sources, else 0.

start.cmd uses this so the served app can never silently lag behind the code:

    python scripts/frontend_stale.py || (cd frontend && npx vite build)
"""
from __future__ import annotations

import sys
from pathlib import Path

FRONTEND = Path(__file__).resolve().parents[1] / "frontend"
SOURCES = ["src", "public", "index.html", "package.json", "vite.config.ts", "tsconfig.json"]


def newest(path: Path) -> float:
    if path.is_file():
        return path.stat().st_mtime
    if not path.is_dir():
        return 0.0
    return max((p.stat().st_mtime for p in path.rglob("*") if p.is_file()), default=0.0)


def is_stale(frontend: Path = FRONTEND) -> bool:
    built = frontend / "dist" / "index.html"
    if not built.is_file():
        return True
    return max(newest(frontend / s) for s in SOURCES) > built.stat().st_mtime


if __name__ == "__main__":
    stale = is_stale()
    print("frontend build is " + ("STALE (sources are newer than dist)" if stale else "up to date"))
    sys.exit(1 if stale else 0)
