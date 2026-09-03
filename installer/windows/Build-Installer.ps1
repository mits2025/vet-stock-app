[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$installerRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $installerRoot '..\..')
$payloadRoot = Join-Path $installerRoot 'payload\app'
$package = Get-Content -Raw (Join-Path $projectRoot 'package.json') | ConvertFrom-Json

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw 'Node.js was not found. Install Node.js before building the installer.' }
$nodeVersion = (& $nodeCommand.Source --version).TrimStart('v').Split('.')[0]
if ([int]$nodeVersion -lt 22) { throw 'Node.js 22 or newer is required for the built-in SQLite runtime.' }

$isccCandidates = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
  (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe')
)
$iscc = $isccCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $iscc) { throw 'Inno Setup 6 was not found. Install it before building the Vet POS installer.' }

& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Vet POS production build failed.' }

if (Test-Path -LiteralPath $payloadRoot) {
  $resolvedPayload = (Resolve-Path -LiteralPath $payloadRoot).Path
  $resolvedInstaller = (Resolve-Path -LiteralPath $installerRoot).Path
  if (-not $resolvedPayload.StartsWith($resolvedInstaller, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to replace a payload outside the installer workspace: $resolvedPayload"
  }
  Remove-Item -LiteralPath $resolvedPayload -Recurse -Force
}

New-Item -ItemType Directory -Force -Path (Join-Path $payloadRoot 'runtime') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $payloadRoot 'server') | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'dist') -Destination (Join-Path $payloadRoot 'dist') -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'server\index.cjs') -Destination (Join-Path $payloadRoot 'server\index.cjs')
Copy-Item -LiteralPath $nodeCommand.Source -Destination (Join-Path $payloadRoot 'runtime\node.exe')

& $iscc "/DMyAppVersion=$($package.version)" (Join-Path $installerRoot 'VetPOSLocal.iss')
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup compilation failed.' }

Write-Host "Installer created in $(Join-Path $installerRoot 'output')"
