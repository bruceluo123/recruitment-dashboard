param(
  [ValidateSet('a', 'b')]
  [string]$Account = 'a'
)

Set-Location -LiteralPath 'D:\projects\recruitment-dashboard'
. (Join-Path $PSScriptRoot 'windows-system-proxy.ps1')

$root = 'D:\projects\recruitment-dashboard'
$workerScript = Join-Path $root 'scripts\tg-delivery-worker.mjs'
$stdoutLog = if ($Account -eq 'b') { Join-Path $root 'artifacts\tg-delivery-worker-b.log' } else { Join-Path $root 'artifacts\tg-delivery-worker.log' }
$stderrLog = if ($Account -eq 'b') { Join-Path $root 'artifacts\tg-delivery-worker-b-error.log' } else { Join-Path $root 'artifacts\tg-delivery-worker-error.log' }
New-Item -ItemType Directory -Path (Split-Path $stdoutLog) -Force | Out-Null

Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'node.exe' -and $_.CommandLine -like "*tg-delivery-worker.mjs*--account $Account*"
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
  $env:TG_ACCOUNT = $Account
  Remove-Item Env:HTTP_PROXY, Env:HTTPS_PROXY, Env:NODE_USE_ENV_PROXY -ErrorAction SilentlyContinue
  $env:NODE_NO_WARNINGS = '1'

  $process = Start-Process -FilePath 'node.exe' `
    -ArgumentList @($workerScript, '--watch', '--account', $Account) `
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
