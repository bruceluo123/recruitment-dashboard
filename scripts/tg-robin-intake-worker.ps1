Set-StrictMode -Version Latest

$root = 'D:\projects\recruitment-dashboard'
$proxyScript = Join-Path $root 'scripts\windows-system-proxy.ps1'
$workerScript = Join-Path $root 'scripts\tg-robin-intake-worker.mjs'
$stdoutLog = Join-Path $root 'artifacts\tg-robin-intake.log'
$stderrLog = Join-Path $root 'artifacts\tg-robin-intake-error.log'

Set-Location -LiteralPath $root
. $proxyScript
New-Item -ItemType Directory -Path (Split-Path $stdoutLog) -Force | Out-Null

# A stopped scheduled-task wrapper can leave its child behind. Always begin with
# one Robin watcher so a candidate is never forwarded more than once.
Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'node.exe' -and $_.CommandLine -like '*tg-robin-intake-worker.mjs*--watch*'
} | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

while ($true) {
  $proxy = Wait-WindowsSystemProxy -TimeoutSeconds 15
  if (-not $proxy) {
    Start-Sleep -Seconds 5
    continue
  }

  $env:TG_PROXY = $proxy.Endpoint
  Remove-Item Env:HTTP_PROXY, Env:HTTPS_PROXY, Env:NODE_USE_ENV_PROXY -ErrorAction SilentlyContinue
  $env:NODE_NO_WARNINGS = '1'

  $process = Start-Process -FilePath 'node.exe' `
    -ArgumentList @($workerScript, '--watch') `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru

  while (-not $process.HasExited) {
    Start-Sleep -Seconds 3
    $current = Get-WindowsSystemProxy
    if (-not $current -or $current.Signature -ne $proxy.Signature) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      break
    }
  }
  Start-Sleep -Seconds 3
}
