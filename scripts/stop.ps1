# Imperial Base - stop the running servers.
# Finds what is listening on the base's ports (8742 command server, 5273 Vite dev server) and ends a process only if
# the base recorded it as one of its own: the backend and the Vite dev server each write a record (process id and
# start time) to <base dir>\run when they start. A process with no matching record - any other program, even a
# Python or Node one, or a new process that reused an old id - is left alone. -DryRun reports without stopping.
param(
  [int[]]$Ports = @(8742, 5273),
  [string]$BaseDir = $(if ($env:IMPERIAL_BASE_DIR) { $env:IMPERIAL_BASE_DIR } else { Join-Path $HOME '.imperial-base' }),
  [switch]$DryRun
)

$runDir = Join-Path $BaseDir 'run'
$records = @()
if (Test-Path -LiteralPath $runDir -PathType Container) {
  foreach ($f in Get-ChildItem -LiteralPath $runDir -Filter '*.json' -File -ErrorAction SilentlyContinue) {
    try { $records += (Get-Content -LiteralPath $f.FullName -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop) }
    catch { }  # unreadable records are ignored, never trusted
  }
}

function Get-StartSeconds([System.Diagnostics.Process]$p) {
  try { return ([DateTimeOffset]$p.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds() / 1000.0 } catch { return $null }
}

function Test-Recorded([int]$procId, $started) {
  # A record matches when it names this process id (or, for a reloading backend, this process as its parent) with
  # a start time within 3 seconds: process ids are reused, start times are not.
  if ($null -eq $started) { return $false }
  foreach ($r in $records) {
    if ($r.pid -eq $procId -and $null -ne $r.started -and [math]::Abs([double]$r.started - $started) -le 3) { return $true }
    if ($r.parent -eq $procId -and $null -ne $r.parent_started -and [math]::Abs([double]$r.parent_started - $started) -le 3) { return $true }
  }
  return $false
}

$stopped = 0
foreach ($port in $Ports) {
  $owners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $owners) {
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    if (-not (Test-Recorded $procId (Get-StartSeconds $proc))) {
      Write-Host "[Imperial Base] Port $port is held by $($proc.ProcessName) (PID $procId), which the base did not start. Left alone."
      continue
    }
    if ($DryRun) {
      Write-Host "[Imperial Base] Would stop $($proc.ProcessName) (PID $procId) on port $port"
      continue
    }
    Write-Host "[Imperial Base] Stopping $($proc.ProcessName) (PID $procId) on port $port"
    & taskkill /PID $procId /T /F | Out-Null
    $stopped++
  }
}
if ($DryRun) { Write-Host '[Imperial Base] Dry run: nothing was stopped.' }
elseif ($stopped -eq 0) { Write-Host '[Imperial Base] Nothing of the base was running.' }
else { Write-Host "[Imperial Base] Stopped $stopped process(es)." }
