"""Host telemetry for the server bunker displays. Everything is optional and reported honestly."""
from __future__ import annotations

import json
import shutil
import subprocess
import time
from typing import Any

try:
    import psutil  # type: ignore
except Exception:  # pragma: no cover
    psutil = None

_docker_cache: tuple[float, dict[str, Any]] | None = None
_gpu_cache: tuple[float, dict[str, Any]] | None = None


def _gpu() -> dict[str, Any]:
    global _gpu_cache
    if _gpu_cache and time.time() - _gpu_cache[0] < 30:
        return _gpu_cache[1]
    info: dict[str, Any] = {"available": False, "reason": "nvidia-smi not found (GPU utilisation unavailable on this adapter)"}
    if shutil.which("nvidia-smi"):
        try:
            out = subprocess.run(
                ["nvidia-smi", "--query-gpu=name,utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=3,
            ).stdout.strip().splitlines()
            gpus = []
            for line in out:
                name, util, used, total = [x.strip() for x in line.split(",")]
                gpus.append({"name": name, "util_pct": float(util), "mem_used_mb": float(used), "mem_total_mb": float(total)})
            info = {"available": True, "gpus": gpus}
        except Exception as e:  # pragma: no cover
            info = {"available": False, "reason": f"nvidia-smi failed: {type(e).__name__}"}
    _gpu_cache = (time.time(), info)
    return info


def docker_status() -> dict[str, Any]:
    """`docker ps` summary, cached 30 s. Never starts Docker."""
    global _docker_cache
    if _docker_cache and time.time() - _docker_cache[0] < 30:
        return _docker_cache[1]
    info: dict[str, Any] = {"available": False}
    if shutil.which("docker"):
        try:
            r = subprocess.run(["docker", "ps", "--format", "{{json .}}"], capture_output=True, text=True, timeout=4)
            if r.returncode == 0:
                rows = [json.loads(l) for l in r.stdout.splitlines() if l.strip()]
                info = {"available": True, "containers": [
                    {"name": c.get("Names"), "image": c.get("Image"), "status": c.get("Status")} for c in rows]}
            else:
                info = {"available": False, "reason": "Docker engine not running"}
        except Exception as e:
            info = {"available": False, "reason": f"docker unavailable: {type(e).__name__}"}
    else:
        info = {"available": False, "reason": "docker CLI not installed"}
    _docker_cache = (time.time(), info)
    return info


def sample() -> dict[str, Any]:
    out: dict[str, Any] = {"ts": time.time()}
    if psutil:
        vm = psutil.virtual_memory()
        out["cpu_pct"] = psutil.cpu_percent(interval=None)
        out["cpu_count"] = psutil.cpu_count()
        out["mem_used_gb"] = round(vm.used / 1e9, 2)
        out["mem_total_gb"] = round(vm.total / 1e9, 2)
        out["mem_pct"] = vm.percent
        try:
            out["claude_processes"] = sum(1 for p in psutil.process_iter(["name"]) if "claude" in (p.info.get("name") or "").lower())
        except Exception:
            pass
    else:
        out["unavailable"] = "psutil not installed"
    out["gpu"] = _gpu()
    return out
