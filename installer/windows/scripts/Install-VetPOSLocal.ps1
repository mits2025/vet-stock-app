[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$AppRoot
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$serverPort = 4200
$taskName = 'Vet POS Local Server'
$installRoot = Split-Path -Parent $AppRoot
$dataRoot = Join-Path $installRoot 'data'
$installLog = Join-Path $installRoot 'install.log'
$nodePath = Join-Path $AppRoot 'runtime\node.exe'
$serverPath = Join-Path $AppRoot 'server\index.cjs'
$transcriptStarted = $false

New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
Start-Transcript -LiteralPath $installLog -Append -Force | Out-Null
$transcriptStarted = $true

trap {
  $failureMessage = $_.Exception.Message
  Write-Host "INSTALLATION FAILED: $failureMessage"
  if ($transcriptStarted) { Stop-Transcript -ErrorAction SilentlyContinue | Out-Null }
  [Console]::Error.WriteLine("Vet POS installation failed. Review $installLog. $failureMessage")
  exit 1
}

function Write-InstallStage {
  param([string]$Message)
  Write-Host "[$([DateTimeOffset]::Now.ToString('o'))] $Message"
}

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Vet POS Setup must be run as Administrator.'
  }
}

Write-InstallStage "Starting Vet POS local installation. Application root: $AppRoot"
Assert-Administrator
Write-InstallStage 'Administrator privileges confirmed.'

if (-not (Test-Path -LiteralPath $nodePath)) { throw 'The bundled Node.js runtime is missing.' }
if (-not (Test-Path -LiteralPath $serverPath)) { throw 'The Vet POS server is missing.' }
if (-not (Test-Path -LiteralPath (Join-Path $AppRoot 'dist\index.html'))) { throw 'The Vet POS web application is missing.' }

New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
$serverConfig = [ordered]@{
  port = $serverPort
  dataDirectory = $dataRoot
}
$serverConfig | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $AppRoot 'server-config.json') -Encoding UTF8
Write-InstallStage 'Server configuration was created.'

$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Start-Sleep -Seconds 1
}

$action = New-ScheduledTaskAction -Execute $nodePath -Argument 'server\index.cjs' -WorkingDirectory $AppRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-InstallStage 'Vet POS scheduled task was registered and started.'

$healthy = $false
for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
  Start-Sleep -Seconds 1
  try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:$serverPort/api/health" -TimeoutSec 2
    if ($response.ok -and $response.service -eq 'vet-pos-local' -and $response.storage -eq 'sqlite') {
      $healthy = $true
      break
    }
  } catch { }
}
if (-not $healthy) { throw 'Vet POS was installed, but its local server did not pass the startup health check.' }
Write-InstallStage 'Vet POS server passed its health check.'

$state = [ordered]@{
  installedAt = [DateTimeOffset]::Now.ToString('o')
  appRoot = $AppRoot
  dataRoot = $dataRoot
  serverPort = $serverPort
  scheduledTask = $taskName
}
$state | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $installRoot 'installer-state.json') -Encoding UTF8
Write-Host "Vet POS installation completed successfully at http://127.0.0.1:$serverPort"
if ($transcriptStarted) { Stop-Transcript | Out-Null }
