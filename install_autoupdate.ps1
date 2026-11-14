# Registers a daily Windows scheduled task that runs autoupdate.bat.
# Usage:  powershell -ExecutionPolicy Bypass -File install_autoupdate.ps1 [-Time 10:00] [-Remove]
param([string]$Time = "10:00", [switch]$Remove)
$name = "DotaHub Update"
if ($Remove) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Task '$name' removed."
    exit 0
}
$bat = Join-Path $PSScriptRoot "autoupdate.bat"
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$bat`"" -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
# StartWhenAvailable: if the PC was off at that time, run as soon as it is on.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Description "Dota Hub: refresh builds and matches" -Force | Out-Null
Write-Host "Task '$name' registered: daily at $Time (log: data\autoupdate.log)."
