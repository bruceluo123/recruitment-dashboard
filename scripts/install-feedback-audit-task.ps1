param(
  [string]$TaskName = 'PenguinIslandFeedbackAudit'
)

$projectRoot = 'D:\projects\recruitment-dashboard'
$auditScript = Join-Path $projectRoot 'scripts\tg-feedback-audit.ps1'
if (-not (Test-Path -LiteralPath $auditScript)) {
  throw "Feedback audit script not found: $auditScript"
}

$arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$auditScript`" -Days 7"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $projectRoot
$triggers = 0..11 | ForEach-Object {
  $runAt = (Get-Date).Date.AddMinutes(10).AddHours($_ * 2)
  New-ScheduledTaskTrigger -Daily -At $runAt
}
$settingsParams = @{
  AllowStartIfOnBatteries = $true
  DontStopIfGoingOnBatteries = $true
  StartWhenAvailable = $true
  ExecutionTimeLimit = New-TimeSpan -Hours 2
  MultipleInstances = 'IgnoreNew'
}
$settings = New-ScheduledTaskSettingsSet @settingsParams

$taskParams = @{
  TaskName = $TaskName
  Action = $action
  Trigger = $triggers
  Settings = $settings
  Description = 'Penguin Island feedback OCR audit and chat sync every 2 hours.'
  Force = $true
}
Register-ScheduledTask @taskParams | Out-Null

Write-Output "Scheduled task installed: $TaskName"
