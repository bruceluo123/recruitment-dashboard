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

while ($true) {
  $proxyPort = Get-ProxyPort
  if (Test-LocalPort $proxyPort) {
    $env:TG_PROXY = "127.0.0.1:$proxyPort"
    $env:HTTP_PROXY = "http://127.0.0.1:$proxyPort"
    $env:HTTPS_PROXY = "http://127.0.0.1:$proxyPort"
    $env:NODE_USE_ENV_PROXY = '1'
    $env:NODE_NO_WARNINGS = '1'
    & node scripts/tg-delivery-worker.mjs --watch >> artifacts/tg-delivery-worker.log 2>&1
  }
  Start-Sleep -Seconds 5
}
