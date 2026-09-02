param(
  [int]$Days = 15,
  [string]$From = '',
  [string]$To = ''
)

Set-Location -LiteralPath 'D:\projects\recruitment-dashboard'
. (Join-Path $PSScriptRoot 'windows-system-proxy.ps1')

$proxy = Wait-WindowsSystemProxy
if (-not $proxy) {
  throw 'Windows system proxy is disabled or the current local proxy port is not listening'
}

$env:TG_PROXY = $proxy.Endpoint
Remove-Item Env:HTTP_PROXY, Env:HTTPS_PROXY, Env:NODE_USE_ENV_PROXY -ErrorAction SilentlyContinue
$env:NODE_NO_WARNINGS = '1'

$deliveryTask = 'PenguinIslandTgDeliveryWorker'
$restartDelivery = $false
$exitCode = 1

function Stop-DeliveryWorkerProcess {
  Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'node.exe' -and
    $_.CommandLine -like '*tg-delivery-worker.mjs*' -and
    $_.CommandLine -like '*--account a*'
  } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

  for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    $remaining = Get-CimInstance Win32_Process | Where-Object {
      $_.Name -eq 'node.exe' -and
      $_.CommandLine -like '*tg-delivery-worker.mjs*' -and
      $_.CommandLine -like '*--account a*'
    }
    if (-not $remaining) { return }
    Start-Sleep -Milliseconds 500
  }
  throw 'Telegram delivery worker for account a did not stop cleanly'
}

try {
  $task = Get-ScheduledTask -TaskName $deliveryTask -ErrorAction SilentlyContinue
  if ($task -and $task.State -eq 'Running') {
    Stop-ScheduledTask -TaskName $deliveryTask
    $restartDelivery = $true
  }
  Stop-DeliveryWorkerProcess

  $arguments = @('scripts/tg-feedback-audit.mjs', '--days', [string]$Days)
  if ($From) { $arguments += @('--from', $From) }
  if ($To) { $arguments += @('--to', $To) }
  & node @arguments
  $exitCode = $LASTEXITCODE
} finally {
  if ($restartDelivery) {
    Start-ScheduledTask -TaskName $deliveryTask
  }
}

exit $exitCode
