"""Secret redaction on the server: the same patterns, in the same order, as hooks/imperial-hook.js.

The hook redacts before anything reaches disk. The backend redacts again when a record is accepted (from the spool
or POST /api/ingest), so a record written by an older hook, another program or by hand cannot put a recognisable
secret into the database or the live feed. Pattern matching cannot recognise every secret: an unlabelled password
of ordinary words passes. See SECURITY.md for the limits.
"""
from __future__ import annotations

import re
from typing import Any

R = "[redacted]"
_F = re.IGNORECASE | re.ASCII
_SECRET_KEYS = (r"(?:api[_-]?key|apikey|access[_-]?key|secret[_-]?key|private[_-]?key|client[_-]?secret|secret|token"
                r"|password|passwd|passphrase|pwd|pass|auth|credentials?|cookie)")

# (?!\[redacted\]): a value already replaced is not matched again, so redacting twice changes nothing.
_NR = r"(?!\[redacted\])"

RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\b((?:proxy-)?authorization)([\"']?\s*[:=]\s*)(?:(?:bearer|basic|digest|token|negotiate|ntlm)\s+)?"
                + _NR + r"(\"[^\"]*\"|'[^']*'|[^\s,;&'\"]+)", _F), r"\1\2" + R),
    (re.compile(r"\b([a-z][a-z0-9+.-]*://)[^\s/?#@]+@", _F), r"\1" + R + "@"),
    (re.compile(r"(?<![\w-])(--?(?:[a-z0-9]+-)*(?:password|passwd|pass|pwd|token|secret|api-?key|apikey|auth"
                r"|credentials?|private-key|access-key|client-secret))(\s+)" + _NR + r"(\"[^\"]*\"|'[^']*'|[^\s\"']+)",
                _F), r"\1\2" + R),
    (re.compile(r"(?<![A-Za-z0-9])((?:[A-Za-z0-9]+[_.-])*" + _SECRET_KEYS + r")([\"']?\s*[:=]\s*)" + _NR +
                r"(\"[^\"]*\"|'[^']*'|[^\s,;&'\"}\])]+)", _F), r"\1\2" + R),
    (re.compile(r"\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}", _F), r"\1 " + R),
    (re.compile(r"\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}", re.ASCII), R),
    (re.compile(r"\bwhsec_[A-Za-z0-9]{16,}", re.ASCII), R),
    (re.compile(r"\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}", re.ASCII), R),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{16,}", re.ASCII), R),
    (re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}", re.ASCII), R),
    (re.compile(r"\bglpat-[A-Za-z0-9_-]{20,}", re.ASCII), R),
    (re.compile(r"\bhf_[A-Za-z0-9]{20,}", re.ASCII), R),
    (re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}", re.ASCII), R),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b", re.ASCII), R),
    (re.compile(r"\bAIza[0-9A-Za-z_-]{20,}", re.ASCII), R),
    (re.compile(r"\bnpm_[A-Za-z0-9]{30,}", re.ASCII), R),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}", re.ASCII), R),
    (re.compile(r"\b[0-9a-fA-F]{32,}\b", re.ASCII), R),
    (re.compile(r"\b[A-Za-z0-9+/_-]{40,}\b", re.ASCII), R),
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+", re.ASCII), R),
]

# Fields that identify a session, a tool call or a local path written by Claude Code itself; not redacted (a
# redacted session id or transcript path would break the record). Every other string is.
IDENTITY_FIELDS = frozenset({"v", "ts", "event", "session_id", "tool_use_id", "agent_id", "cwd", "project",
                             "transcript_path", "agent_transcript_path"})


def redact_text(value: Any) -> str:
    """``value`` as text with every recognisable secret replaced by ``[redacted]``. Never raises on odd input."""
    s = "" if value is None else str(value)
    for pattern, replacement in RULES:
        s = pattern.sub(replacement, s)
    return s
