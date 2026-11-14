# Imperial Base - stop the running servers.
# Finds whatever is listening on the base's ports (8742 command server, 5273 Vite dev server) and ends
# that process together with its children (uvicorn's reloader and Vite both run work in child processes).
param([int[]]$Ports = @(8742, 5273))

$stopped = 0
foreach ($port in $Ports) {
  $owners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $owners) {
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    # only ever end the kinds of process the base starts
    if ($proc.ProcessName -notmatch '^(python|pythonw|node|uvicorn)$') {
      Write-Host "[Imperial Base] Port $port is held by $($proc.ProcessName) (PID $procId), which is not part of the base. Left alone."
      continue
    }
    Write-Host "[Imperial Base] Stopping $($proc.ProcessName) (PID $procId) on port $port"
    & taskkill /PID $procId /T /F | Out-Null
    $stopped++
  }
}
if ($stopped -eq 0) { Write-Host '[Imperial Base] Nothing was running.' }
else { Write-Host "[Imperial Base] Stopped $stopped process(es)." }
