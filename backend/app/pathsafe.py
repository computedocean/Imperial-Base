"""Path checks done on strings, before any filesystem call.

Calling ``is_file()``, ``stat()`` or ``resolve()`` on a path that came from outside is already a filesystem access.
On Windows a UNC path (``\\\\host\\share``) makes the system connect to that host and offer the user's credentials,
so a hostile path must be refused while it is still only text. The functions here never touch the filesystem
until the text has been shown to name a plain local path inside an approved folder.
"""
from __future__ import annotations

import ntpath
import os
import re
import sys
from pathlib import Path, PurePosixPath, PureWindowsPath

_WIN_RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(10)), *(f"lpt{i}" for i in range(10))}
_DRIVE_ABS = re.compile(r"^[A-Za-z]:[\\/]")


def _norm_key(p: str) -> str:
    """Comparison key for a local absolute path (case-insensitive on Windows, separators unified)."""
    if sys.platform == "win32":
        return ntpath.normcase(ntpath.normpath(p))
    return os.path.normpath(p)


def _inside(child: str, root: str) -> bool:
    c, r = _norm_key(child), _norm_key(root).rstrip("\\/")
    sep = "\\" if sys.platform == "win32" else "/"
    return c == r or c.startswith(r + sep)


def plain_local_absolute(path: str) -> bool:
    """True only for an ordinary absolute path on a local drive: no UNC, no device or ``\\\\?\\`` prefix, no
    alternate data stream, no reserved device name, no ``..`` component, no NUL. Text only."""
    if not isinstance(path, str) or not path or len(path) > 1024 or "\x00" in path:
        return False
    if sys.platform == "win32":
        if path.startswith(("\\\\", "//", "\\/", "/\\")):  # UNC, \\?\ and \\.\ device paths
            return False
        if not _DRIVE_ABS.match(path):
            return False
        if ":" in path[2:]:  # alternate data streams (file.txt:stream) or a second drive
            return False
        parts = PureWindowsPath(path).parts[1:]
    else:
        if not path.startswith("/") or path.startswith("//"):
            return False
        parts = PurePosixPath(path).parts[1:]
    for part in parts:
        if part in ("..", "."):
            return False
        if sys.platform == "win32" and part.split(".")[0].rstrip(" ").lower() in _WIN_RESERVED:
            return False
    return True


def safe_file_under(path: str | None, roots: list[Path]) -> Path | None:
    """The file ``path`` names, if it is a plain local path inside one of ``roots`` (also after resolving links),
    else None. The text is checked first; the filesystem is touched only once it has passed."""
    if not path or not plain_local_absolute(path):
        return None
    root_strs = [str(r) for r in roots if plain_local_absolute(str(r))]
    if not any(_inside(path, r) for r in root_strs):
        return None
    try:
        real = Path(path).resolve()
    except (OSError, RuntimeError, ValueError):
        return None
    real_s = str(real)
    if not plain_local_absolute(real_s) or not any(_inside(real_s, str(Path(r).resolve())) for r in root_strs):
        return None  # a link inside an approved folder that points somewhere else
    return real


def safe_relative_under(rel: str, root: Path) -> Path | None:
    """A URL path such as ``assets/app.js`` joined onto ``root``, if it stays inside it; else None.

    Refused as text: backslashes, colons, NUL, a leading slash, empty, ``.`` or ``..`` segments, and reserved
    device names. Only then is the candidate resolved and checked to still sit inside ``root``."""
    if not rel or len(rel) > 512 or any(ch in rel for ch in ("\\", ":", "\x00")) or rel.startswith("/"):
        return None
    segments = rel.split("/")
    for seg in segments:
        if seg in ("", ".", ".."):
            return None
        if seg.split(".")[0].rstrip(" ").lower() in _WIN_RESERVED:
            return None
    root_real = root.resolve()
    candidate = root_real.joinpath(*segments)
    if not _inside(str(candidate), str(root_real)):
        return None
    try:
        real = candidate.resolve()
    except (OSError, RuntimeError, ValueError):
        return None
    if not plain_local_absolute(str(real)) or not _inside(str(real), str(root_real)):
        return None
    return real
