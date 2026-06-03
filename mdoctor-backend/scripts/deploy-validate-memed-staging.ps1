# Deploy + validação Memed UX — staging only
# Pré-requisito: railway login

$ErrorActionPreference = 'Stop'
$BackendProject = 'bed0e3b3-fa4b-4bc2-a7fb-dcabca09cd9b'
$BackendEnv = 'd297af6e-c5e2-406a-9798-69a02f0e7394'
$BackendService = '53960eb4-a1be-4d7c-b665-462049e52085'
$PanelProject = '3bec26a7-422e-40ae-8763-2a4c5158fef4'
$PanelEnv = 'staging'
$PanelService = 'painel-medico-staging'
$SinapseUrl = 'https://integrations.memed.com.br/modulos/plataforma.sinapse-prescricao/build/sinapse-prescricao.min.js'
$BackendUrl = 'https://mdoctor-backend-staging-staging.up.railway.app'
$PanelUrl = 'https://painel-medico-staging-staging.up.railway.app'
$AtendimentoId = '558fa61f-43b9-4a76-8cc1-a5665c275fcf'

Write-Host '>> Railway whoami'
railway whoami

Write-Host '>> Env backend (Sinapse script + widget flag)'
railway variable set "MEMED_SCRIPT_URL=$SinapseUrl" "MEMED_WIDGET_SCRIPT=sinapse" -p $BackendProject -e $BackendEnv -s $BackendService

Write-Host '>> Env painel'
railway variable set "NEXT_PUBLIC_MEMED_REAL_ENABLED=true" "NEXT_PUBLIC_ENABLE_MOCK_FALLBACK=false" -p $PanelProject -e $PanelEnv -s $PanelService

Write-Host '>> Deploy backend'
Push-Location (Split-Path $PSScriptRoot -Parent)
railway up --detach -p $BackendProject -e $BackendEnv -s $BackendService
Pop-Location

Write-Host '>> Deploy painel'
Push-Location (Join-Path (Split-Path $PSScriptRoot -Parent) '..\mdoctor-panel')
railway up --detach -p $PanelProject -e $PanelEnv -s $PanelService
Pop-Location

Write-Host '>> Aguardar 90s...'
Start-Sleep -Seconds 90

Write-Host '>> /readyz'
(Invoke-RestMethod "$BackendUrl/readyz").memed | ConvertTo-Json

Write-Host '>> /api/memed/config scriptUrl'
$config = Invoke-RestMethod "$BackendUrl/api/memed/config"
$config.config.scriptUrl

Write-Host '>> Painel /receita'
(Invoke-WebRequest "$PanelUrl/receita?atendimentoId=$AtendimentoId" -UseBasicParsing).StatusCode

Write-Host 'OK — abra no navegador após login:'
Write-Host "$PanelUrl/receita?atendimentoId=$AtendimentoId"
