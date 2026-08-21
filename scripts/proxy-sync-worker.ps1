Set-Location -LiteralPath 'D:\projects\recruitment-dashboard'
. (Join-Path $PSScriptRoot 'windows-system-proxy.ps1')

$logPath = Join-Path (Get-Location) 'artifacts\proxy-sync-worker.log'
New-Item -ItemType Directory -Path (Split-Path -Parent $logPath) -Force | Out-Null
$lastSignature = ''
$candidateSignature = ''
$candidateReads = 0
$dependentTasks = @('PenguinIslandTgDeliveryWorker', 'PenguinIslandTgDeliveryWorkerBobo')

while ($true) {
  $proxy = Get-WindowsSystemProxy
  if ($proxy -and $proxy.Signature -eq $candidateSignature) {
    $candidateReads++
  } elseif ($proxy) {
    $candidateSignature = $proxy.Signature
    $candidateReads = 1
  } else {
    $candidateSignature = ''
    $candidateReads = 0
  }

  if ($proxy -and $candidateReads -ge 2 -and $proxy.Signature -ne $lastSignature) {
    if ($lastSignature) {
      Get-CimInstance Win32_Process |
        Where-Object {
          $_.Name -eq 'Tabbit Browser.exe' -and
          $_.CommandLine -match 'network\.mojom\.NetworkService'
        } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

      foreach ($taskName in $dependentTasks) {
        $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if (-not $task) { continue }
        if ($task.State -eq 'Running') { Stop-ScheduledTask -TaskName $taskName }
        Start-ScheduledTask -TaskName $taskName
      }
    }
    "$(Get-Date -Format o) active proxy $($proxy.Endpoint)" | Add-Content -LiteralPath $logPath
    $lastSignature = $proxy.Signature
  }
  Start-Sleep -Seconds 2
}
