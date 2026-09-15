param(
  [ValidateSet('a', 'b')]
  [string]$Account = 'a'
)

# Resume intake runs every five minutes inside the sender, sharing its Telegram
# connection. This watchdog must never stop an in-flight delivery.
$deliveryTask = if ($Account -eq 'b') { 'PenguinIslandTgDeliveryWorkerBobo' } else { 'PenguinIslandTgDeliveryWorker' }
$task = Get-ScheduledTask -TaskName $deliveryTask -ErrorAction Stop
if (-not $task.Settings.Enabled) { exit 0 }
if ($task.State -ne 'Running') { Start-ScheduledTask -TaskName $deliveryTask }
exit 0
