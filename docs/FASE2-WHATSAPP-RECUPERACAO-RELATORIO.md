# Fase 2 — Recuperação WhatsApp Staging

**Gerado:** 2026-06-07T09:31:51.714Z

## Instância mdoctor-staging
- Existe: **true**
- ID: `aa0ac829-44ab-44ed-bbb5-e3bd840e7381` (esperado `aa0ac829-44ab-44ed-bbb5-e3bd840e7381`)
- Estado: `connecting` / `connecting`

## API Key alinhada
- Backend `EVOLUTION_API_KEY` → `mdoc_doctorprescreve_2026`
- Evolution `AUTHENTICATION_API_KEY` → mesma chave
- Railway set: **OK**

## Webhooks
- Oficial staging: `https://n8n-staging-staging-2dfe.up.railway.app/webhook/evolution-webhook`
- Por instância (após correção): `https://n8n-staging-staging-2dfe.up.railway.app/webhook/evolution-webhook`

## QR Code
- Gerado: **sim**
- Arquivo: `docs/FASE2-WHATSAPP-QR-mdoctor-staging.png`
- Estado pós-connect: `connecting`

## Validação
- Backend provider fetchInstances: **true**
- n8n evolution webhook: **false** (404)
- Supabase connected: **true**
- E2E: **FALHA**

## Ações executadas
- confirmar instancia existente (sem create): OK
- railway variable set EVOLUTION_API_KEY on mdoctor-backend-staging: OK
- webhook/set/mdoctor-staging: OK
- aguardar redeploy backend (25s): OK