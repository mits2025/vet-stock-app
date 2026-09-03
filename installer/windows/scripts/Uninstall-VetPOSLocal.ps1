[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
$installRoot = 'C:\ProgramData\Vet POS'
$uninstallLog = Join-Path $installRoot 'uninstall.log'
$taskName = 'Vet POS Local Server'

New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
Start-Transcript -LiteralPath $uninstallLog -Append -Force | Out-Null
Write-Host "[$([DateTimeOffset]::Now.ToString('o'))] Starting Vet POS uninstall cleanup."

Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Stop-ScheduledTask -ErrorAction SilentlyContinue
Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false -ErrorAction SilentlyContinue

Write-Host 'Automatic startup was removed.'
Write-Host 'Clinic data was preserved in C:\ProgramData\Vet POS\data.'
Stop-Transcript | Out-Null
