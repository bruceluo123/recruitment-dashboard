param(
  [ValidateSet('a', 'b')]
  [string]$Account = 'a'
)

Set-Location -LiteralPath 'D:\projects\recruitment-dashboard'
. (Join-Path $PSScriptRoot 'windows-system-proxy.ps1')

$proxy = Wait-WindowsSystemProxy
if (-not $proxy) {
  "$(Get-Date -Format o) TG resume sync skipped: Windows system proxy is disabled or not listening" >> artifacts/tg-sync-scheduled.log
  exit 2
}

$env:TG_PROXY = $proxy.Endpoint
$env:TG_ACCOUNT = $Account
Remove-Item Env:HTTP_PROXY, Env:HTTPS_PROXY, Env:NODE_USE_ENV_PROXY -ErrorAction SilentlyContinue
$env:NODE_NO_WARNINGS = '1'

$logPath = if ($Account -eq 'b') { 'artifacts/tg-sync-scheduled-b.log' } else { 'artifacts/tg-sync-scheduled.log' }
$deliveryTask = if ($Account -eq 'b') { 'PenguinIslandTgDeliveryWorkerBobo' } else { 'PenguinIslandTgDeliveryWorker' }
$restartDelivery = $false
$exitCode = 1

try {
  $task = Get-ScheduledTask -TaskName $deliveryTask -ErrorAction SilentlyContinue
  if ($task -and $task.State -eq 'Running') {
    Stop-ScheduledTask -TaskName $deliveryTask
    $restartDelivery = $true
    Start-Sleep -Seconds 2
  }

  & node scripts/tg-sync-resumes.mjs --write --limit 180 --account $Account >> $logPath 2>&1
  $exitCode = $LASTEXITCODE
} finally {
  if ($restartDelivery) {
    Start-ScheduledTask -TaskName $deliveryTask
  }
}

exit $exitCode
