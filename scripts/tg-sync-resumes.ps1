param(
  [ValidateSet('a', 'b')]
  [string]$Account = 'a'
)

Set-Location -LiteralPath 'D:\projects\recruitment-dashboard'

function Get-ProxyPort {
  $configs = @(
    'C:\Users\Administrator\AppData\Local\com.fnjs.clash\data\clash\config.yaml',
    'C:\Users\Administrator\AppData\Local\com.fnjs.clash\data\clashExtra\config.yaml'
  )
  foreach ($config in $configs) {
    if (-not (Test-Path -LiteralPath $config)) { continue }
    $match = [regex]::Match((Get-Content -LiteralPath $config -Raw -Encoding utf8), '(?m)^\s*mixed-port:\s*(\d+)')
    if ($match.Success) { return [int]$match.Groups[1].Value }
  }
  return 23308
}

function Test-LocalPort([int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $task = $client.ConnectAsync('127.0.0.1', $Port)
    return $task.Wait(1000) -and $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

$proxyPort = Get-ProxyPort
if (-not (Test-LocalPort $proxyPort)) {
  "$(Get-Date -Format o) TG resume sync skipped: proxy port $proxyPort is offline" >> artifacts/tg-sync-scheduled.log
  exit 2
}

$env:TG_PROXY = "127.0.0.1:$proxyPort"
$env:TG_ACCOUNT = $Account
$env:HTTP_PROXY = "http://127.0.0.1:$proxyPort"
$env:HTTPS_PROXY = "http://127.0.0.1:$proxyPort"
$env:NODE_USE_ENV_PROXY = '1'
$env:NODE_NO_WARNINGS = '1'

$logPath = if ($Account -eq 'b') { 'artifacts/tg-sync-scheduled-b.log' } else { 'artifacts/tg-sync-scheduled.log' }
& node scripts/tg-sync-resumes.mjs --write --limit 180 --account $Account >> $logPath 2>&1
exit $LASTEXITCODE
