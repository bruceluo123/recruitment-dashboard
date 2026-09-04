param(
  [int]$Days = 7,
  [string]$From = '',
  [string]$To = '',
  [ValidateSet('a', 'b', 'all')]
  [string]$Account = 'all',
  [switch]$NoSync,
  [switch]$ReuseOcr
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

$exitCode = 0

function Stop-DeliveryWorkerProcess {
  param([string]$TargetAccount)

  Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'node.exe' -and
    $_.CommandLine -like '*tg-delivery-worker.mjs*' -and
    $_.CommandLine -like "*--account $TargetAccount*"
  } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

  for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    $remaining = Get-CimInstance Win32_Process | Where-Object {
      $_.Name -eq 'node.exe' -and
      $_.CommandLine -like '*tg-delivery-worker.mjs*' -and
      $_.CommandLine -like "*--account $TargetAccount*"
    }
    if (-not $remaining) { return }
    Start-Sleep -Milliseconds 500
  }
  throw "Telegram delivery worker for account $TargetAccount did not stop cleanly"
}

$accounts = if ($Account -eq 'all') { @('a', 'b') } else { @($Account) }

foreach ($targetAccount in $accounts) {
  $deliveryTask = if ($targetAccount -eq 'b') { 'PenguinIslandTgDeliveryWorkerBobo' } else { 'PenguinIslandTgDeliveryWorker' }
  $restartDelivery = $false
  $deliveryRestarted = $false
  $mutex = New-Object System.Threading.Mutex($false, "Global\PenguinIslandTgMaintenance-$targetAccount")
  $lockAcquired = $false
  try {
    try { $lockAcquired = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $lockAcquired = $true }
    if (-not $lockAcquired) {
      Write-Output "Telegram maintenance for account $targetAccount is already running; feedback audit skipped"
      continue
    }

    $task = Get-ScheduledTask -TaskName $deliveryTask -ErrorAction SilentlyContinue
    if ($task -and $task.State -eq 'Running') {
      Stop-ScheduledTask -TaskName $deliveryTask
      $restartDelivery = $true
    }
    Stop-DeliveryWorkerProcess -TargetAccount $targetAccount

    $arguments = @('scripts/tg-feedback-audit.mjs', '--days', [string]$Days, '--owner', $targetAccount)
    if ($From) { $arguments += @('--from', $From) }
    if ($To) { $arguments += @('--to', $To) }
    if (-not $NoSync) { $arguments += '--sync' }
    if ($ReuseOcr) { $arguments += '--reuse-ocr' }
    & node @arguments 2>&1 | ForEach-Object {
      $line = [string]$_
      Write-Output $line
      if ($line -eq "__TG_SESSION_RELEASED__:$targetAccount" -and $restartDelivery -and -not $deliveryRestarted) {
        Start-ScheduledTask -TaskName $deliveryTask
        $deliveryRestarted = $true
      }
    }
    if ($LASTEXITCODE -ne 0 -and $exitCode -eq 0) {
      $exitCode = $LASTEXITCODE
    }
  } finally {
    if ($restartDelivery -and -not $deliveryRestarted) {
      Start-ScheduledTask -TaskName $deliveryTask
    }
    if ($lockAcquired) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
  }
}

exit $exitCode
