"""Token usage extraction from Claude Code transcript JSONL files.

Only numeric usage counters and the model id are read; message text is never stored.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from . import config
from .pathsafe import safe_file_under

FIELDS = ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")
MAX_BYTES = 64 * 1024 * 1024


def usage_from_transcript(path: str | None, roots: list[Path] | None = None) -> dict[str, Any] | None:
    """Usage totals from a transcript. ``path`` comes from hook events, so it is checked as text first: only a
    plain local file inside an approved folder (``config.TRANSCRIPT_ROOTS``) is ever opened. Network shares,
    device paths and anything outside those folders are refused before any filesystem call."""
    if not path:
        return None
    p = safe_file_under(path, roots if roots is not None else config.TRANSCRIPT_ROOTS)
    if p is None:
        return None
    try:
        if not p.is_file() or p.stat().st_size > MAX_BYTES:
            return None
    except OSError:
        return None
    totals = {k: 0 for k in FIELDS}
    model = None
    seen: set[str] = set()
    found = False
    try:
        with p.open("r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if '"usage"' not in line:
                    continue
                try:
                    o = json.loads(line)
                except ValueError:
                    continue
                msg = o.get("message") if isinstance(o, dict) else None
                if not isinstance(msg, dict) or o.get("type") != "assistant":
                    continue
                u = msg.get("usage")
                if not isinstance(u, dict):
                    continue
                mid = msg.get("id") or o.get("uuid")
                if mid in seen:  # streamed messages repeat usage per content block
                    continue
                seen.add(mid)
                found = True
                for k in FIELDS:
                    v = u.get(k)
                    if isinstance(v, (int, float)):
                        totals[k] += int(v)
                if msg.get("model"):
                    model = str(msg["model"])
    except OSError:
        return None
    if not found:
        return None
    totals["total_tokens"] = sum(totals[k] for k in FIELDS)
    totals["messages"] = len(seen)
    out: dict[str, Any] = dict(totals)
    if model:
        out["model"] = model
    return out
