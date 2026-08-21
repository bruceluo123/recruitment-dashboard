Set-StrictMode -Version Latest

function Test-LocalProxyPort {
  param(
    [Parameter(Mandatory = $true)][string]$HostName,
    [Parameter(Mandatory = $true)][int]$Port,
    [int]$TimeoutMilliseconds = 1000
  )

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $task = $client.ConnectAsync($HostName, $Port)
    return $task.Wait($TimeoutMilliseconds) -and $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Get-WindowsSystemProxy {
  $settingsPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
  $settings = Get-ItemProperty -LiteralPath $settingsPath -ErrorAction SilentlyContinue
  if (-not $settings -or [int]$settings.ProxyEnable -ne 1) { return $null }

  $raw = [string]$settings.ProxyServer
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }

  $endpoint = $raw.Trim()
  if ($endpoint.Contains('=')) {
    $entries = @{}
    foreach ($part in $endpoint.Split(';', [System.StringSplitOptions]::RemoveEmptyEntries)) {
      $pair = $part.Split('=', 2)
      if ($pair.Count -eq 2) { $entries[$pair[0].Trim().ToLowerInvariant()] = $pair[1].Trim() }
    }
    $endpoint = @($entries['https'], $entries['http'], $entries['socks']) |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
      Select-Object -First 1
  }
  if ([string]::IsNullOrWhiteSpace($endpoint)) { return $null }

  $uriText = if ($endpoint -match '^[a-z][a-z0-9+.-]*://') { $endpoint } else { "http://$endpoint" }
  try { $uri = [Uri]$uriText } catch { return $null }
  if ($uri.Host -notin @('127.0.0.1', 'localhost', '::1') -or $uri.Port -le 0) { return $null }
  if (-not (Test-LocalProxyPort -HostName $uri.Host -Port $uri.Port)) { return $null }

  return [pscustomobject]@{
    Host = $uri.Host
    Port = $uri.Port
    Endpoint = "$($uri.Host):$($uri.Port)"
    Url = "http://$($uri.Host):$($uri.Port)"
    Signature = "$([int]$settings.ProxyEnable)|$raw"
  }
}

function Wait-WindowsSystemProxy {
  param(
    [int]$TimeoutSeconds = 15,
    [int]$PollMilliseconds = 500,
    [int]$RequiredStableReads = 3
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastSignature = ''
  $stableReads = 0
  do {
    $proxy = Get-WindowsSystemProxy
    if ($proxy -and $proxy.Signature -eq $lastSignature) {
      $stableReads++
    } elseif ($proxy) {
      $lastSignature = $proxy.Signature
      $stableReads = 1
    } else {
      $lastSignature = ''
      $stableReads = 0
    }
    if ($proxy -and $stableReads -ge $RequiredStableReads) { return $proxy }
    Start-Sleep -Milliseconds $PollMilliseconds
  } while ((Get-Date) -lt $deadline)
  return $null
}
