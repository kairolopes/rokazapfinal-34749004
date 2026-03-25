Param()
$ErrorActionPreference = "Stop"

# Evitar prompts/gravacao em locais proibidos no ambiente
$env:CI = "true"
$env:UPDATE_NOTIFIER_DISABLE = "1"
$env:NO_UPDATE_NOTIFIER = "1"

# Redireciona o local de config para uma pasta do projeto
$projectConfig = Join-Path (Resolve-Path ".").Path ".config"
if (-not (Test-Path $projectConfig)) {
  New-Item -ItemType Directory -Path $projectConfig | Out-Null
}
$env:XDG_CONFIG_HOME = $projectConfig

Write-Host "Starting Firebase Functions emulator..."
firebase emulators:start --only functions
