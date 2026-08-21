param(
  [ValidateSet('a', 'b')]
  [string]$Account = 'a'
)

Set-Location -LiteralPath 'D:\projects\recruitment-dashboard'
. (Join-Path $PSScriptRoot 'windows-system-proxy.ps1')

while ($true) {
  $proxy = Wait-WindowsSystemProxy -TimeoutSeconds 5
  if ($proxy) {
    $env:TG_PROXY = $proxy.Endpoint
    $env:TG_ACCOUNT = $Account
    Remove-Item Env:HTTP_PROXY, Env:HTTPS_PROXY, Env:NODE_USE_ENV_PROXY -ErrorAction SilentlyContinue
    $env:NODE_NO_WARNINGS = '1'
    $logPath = if ($Account -eq 'b') { 'artifacts/tg-delivery-worker-b.log' } else { 'artifacts/tg-delivery-worker.log' }
    & node scripts/tg-delivery-worker.mjs --watch >> $logPath 2>&1
  }
  Start-Sleep -Seconds 5
}
