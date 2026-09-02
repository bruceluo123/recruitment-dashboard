param(
  [string]$TaskName = 'PenguinIslandFeedbackAudit'
)

$projectRoot = 'D:\projects\recruitment-dashboard'
$auditScript = Join-Path $projectRoot 'scripts\tg-feedback-audit.ps1'
if (-not (Test-Path -LiteralPath $auditScript)) {
  throw "Feedback audit script not found: $auditScript"
}

$arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$auditScript`" -Days 15"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $projectRoot
$triggers = @(
  New-ScheduledTaskTrigger -Daily -At '09:10'
  New-ScheduledTaskTrigger -Daily -At '12:10'
  New-ScheduledTaskTrigger -Daily -At '15:10'
  New-ScheduledTaskTrigger -Daily -At '18:10'
)
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
  Description = 'Penguin Island feedback OCR audit and follow-up inbox sync.'
  Force = $true
}
Register-ScheduledTask @taskParams | Out-Null

Write-Output "Scheduled task installed: $TaskName"
