# Deploy workflow JSON no n8n Docker local (docker/n8n)
# Carrega docker/n8n/.env, valida healthcheck e executa deploy via API.

param(
  [Parameter(Mandatory = $true)]
  [string]$WorkflowFile,
  [string]$ApiKey = $env:N8N_API_KEY,
  [switch]$SkipEnvVerify,
  [switch]$SkipWebhookCheck,
  [switch]$ForceRecreate
)

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$envFile = Join-Path $repoRoot 'docker\n8n\.env'

function Import-DockerN8nEnvFile {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    Write-Error "Arquivo não encontrado: $Path"
  }
  $script:loaded = @()
  Get-Content $Path -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }
    $idx = $line.IndexOf('=')
    if ($idx -lt 1) { return }
    $name = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1).Trim()
    if (
      ($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    if ($name -in @('N8N_BASIC_AUTH_USER', 'N8N_BASIC_AUTH_PASSWORD', 'N8N_API_KEY', 'N8N_BASE_URL', 'BACKEND_BASE_URL')) {
      $alwaysOverride = @('N8N_API_KEY', 'BACKEND_BASE_URL')
      $current = (Get-Item -Path "env:$name" -ErrorAction SilentlyContinue).Value
      if (-not $current -or ($alwaysOverride -contains $name)) {
        if ($value) {
          Set-Item -Path "env:$name" -Value $value
          $script:loaded += $name
        }
      }
    }
  }
  return $script:loaded
}

Write-Host ""
Write-Host "=== n8n deploy local (Doctor Prescreve) ===" -ForegroundColor Cyan

$applied = Import-DockerN8nEnvFile -Path $envFile
if ($applied.Count -gt 0) {
  Write-Host "[INFO] docker/n8n/.env carregado: $($applied -join ', ')" -ForegroundColor DarkGray
} else {
  Write-Host "[INFO] docker/n8n/.env lido (variáveis já definidas no ambiente)" -ForegroundColor DarkGray
}

if (-not $ApiKey -and $env:N8N_API_KEY) {
  $ApiKey = $env:N8N_API_KEY
}
if (-not $ApiKey) {
  Write-Host "[ERRO] Defina N8N_API_KEY (Settings -> n8n API na UI local)" -ForegroundColor Red
  exit 1
}

if (-not $SkipEnvVerify) {
  node (Join-Path $PSScriptRoot 'verify-n8n-local-env.js')
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$env:N8N_TARGET = 'local'
$env:N8N_BASE_URL = 'http://localhost:5678'
$env:N8N_API_KEY = $ApiKey
$env:N8N_WORKFLOW_FILE = $WorkflowFile
if ($SkipWebhookCheck) {
  $env:N8N_SKIP_WEBHOOK_CHECK = '1'
} else {
  Remove-Item Env:N8N_SKIP_WEBHOOK_CHECK -ErrorAction SilentlyContinue
}

if ($ForceRecreate) {
  $env:N8N_DEPLOY_FORCE_RECREATE = '1'
  Write-Host "[INFO] N8N_DEPLOY_FORCE_RECREATE=1 (apaga e recria se validação falhar)" -ForegroundColor DarkGray
} else {
  Remove-Item Env:N8N_DEPLOY_FORCE_RECREATE -ErrorAction SilentlyContinue
}

Write-Host "[INFO] Deploy: $WorkflowFile -> http://localhost:5678" -ForegroundColor DarkGray
node (Join-Path $PSScriptRoot 'deploy-n8n-workflow.js')
exit $LASTEXITCODE
