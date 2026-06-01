# Memed real — staging / homologação

Integração **real** de prescrição (MdHub / Sinapse) no ambiente clínico staging. Sem novos mocks; emissão humana no widget.

**Referência de fluxo React:** [memed-react](https://github.com/devisales/memed-react) (`setDoctorToken` → script → `setPaciente` → abrir módulo). O painel Doctor Prescreve implementa o mesmo padrão em `useMemedSinapse` + `/receita`.

## Ambiente (não usar production)

| Item | Valor |
|------|--------|
| Railway service | `mdoctor-backend-staging` |
| URL API | https://mdoctor-backend-staging-staging.up.railway.app |
| Painel staging | https://painel-medico-staging-staging.up.railway.app |
| Supabase | `usihurogvphtjedyhyfl` |
| **Não usar** | `web` / `web-production-5f178` |

## Flags principais

| Variável | Staging homologação real |
|----------|---------------------------|
| `MEMED_ENABLED` | `true` |
| `MEMED_REAL_ENABLED` | `true` — desliga mocks de receita |
| `MEMED_ALLOW_MOCK_FALLBACK` | `false` |
| `MEMED_ENV` / `MEMED_ENVIRONMENT` | `sandbox` (integrations) ou conforme contrato Memed |
| `MEMED_API_URL` | `https://integrations.api.memed.com.br/v1` (sandbox) |
| `MEMED_MIRROR_PDF_TO_STORAGE` | `true` opcional — espelha PDF HTTPS no bucket `prescriptions` |
| `DELIVERY_MOCK_ENABLED` | `true` até Twilio/Evolution real; ou `DELIVERY_REAL_ENABLED=true` |
| `NEXT_PUBLIC_MEMED_REAL_ENABLED` | `true` no painel staging |

Aliases aceitos no boot: `MEMED_TOKEN` → `MEMED_PRESCRITOR_TOKEN`, `MEMED_CRM` → board number, `MEMED_UF` → UF, `MEMED_INTEGRATION_KEY` → `MEMED_API_KEY`.

## Fluxo real (humano)

1. **Triagem** — `POST /api/webhook/triagem` (n8n ou E2E).
2. **Fila** — painel `/fila`.
3. **Approve** — `POST /api/atendimentos/:id/clinical/approve` (não chama Memed REST).
4. **Memed** — painel `/receita?atendimentoId=<uuid>`:
   - `GET /api/memed/config`
   - `GET /api/memed/token` (login médico + prescritor Memed)
   - Script Sinapse → `MdHub` → `setPaciente` (dados do prontuário)
   - Médico emite e assina no widget (Bird ID)
   - Callback `prescricaoImpressa` → `POST /api/memed/receita` com `receitaId` + `pdfUrl` **HTTPS reais**
5. **Validar** — `POST /api/atendimentos/:id/clinical/validate`
6. **Entregar** — `POST /api/atendimentos/:id/deliver` (WhatsApp real se `DELIVERY_REAL_ENABLED` / providers configurados)

## O que é bloqueado com `MEMED_REAL_ENABLED=true`

- IDs `mock-*`, `mock-receipt-*`
- URLs `example.invalid`, `/api/prescriptions/.../pdf` simulado
- Fallback silencioso em `GET /api/prescriptions/:id` e PDF fake
- E2E `persistMemedReceipt` sem `MEMED_RECEITA_ID` + `MEMED_PDF_URL` (exige emissão humana prévia)

## Credenciais e login médico

Preencher no Railway **staging** (via `.env` local + sync):

```bash
cd mdoctor-backend
LOAD_RAILWAY_VARS=0 npm run railway:sync-memed-staging
railway redeploy --yes   # service linkada: mdoctor-backend-staging
```

Prescritor (exemplo):

```env
MEMED_PRESCRITOR_EXTERNAL_ID=dr_max_vinicius_001
MEMED_PRESCRITOR_NOME=Max
MEMED_PRESCRITOR_SOBRENOME=Vinicius Ferreira Matos
MEMED_PRESCRITOR_CPF=...
MEMED_PRESCRITOR_BOARD_NUMBER=163032
MEMED_PRESCRITOR_BOARD_STATE=SP
MEMED_CIDADE_ID=5273
MEMED_ESPECIALIDADE_ID=45
```

## Validação técnica

```bash
cd mdoctor-backend
LOAD_RAILWAY_VARS=0 npm run staging:memed-real-preflight
```

Esperado: `readyz.memed.configured=true`, token Memed OK, bloqueio de receipt mock quando `MEMED_REAL_ENABLED` no servidor.

Após emissão humana:

```bash
set MEMED_RECEITA_ID=<id-memed>
set MEMED_PDF_URL=<url-https-pdf>
LOAD_RAILWAY_VARS=0 npm run staging:e2e:fluxo-medico
```

## Persistência Supabase

| Tabela | Conteúdo |
|--------|----------|
| `prescriptions` | `provider=memed`, `provider_prescription_id`, `pdf_url` HTTPS |
| `receitas_memed` | compat legado |
| `audit_logs` | `memed_receipt_persisted`, `memed_emission_started` |
| `integration_logs` | falhas/sucesso de integração (quando instrumentado) |
| `prescription_delivery` / `entregas_receita` | após deliver |
| `whatsapp_messages` | envio real (provider configurado) |

Bucket opcional: `prescriptions` (`MEMED_MIRROR_PDF_TO_STORAGE=true`).

## Callback

`MEMED_CALLBACK_URL` — documentar URL pública se Memed exigir webhook de pós-emissão (hoje o fluxo oficial usa callback JS do widget → `POST /api/memed/receita`).

## Rollback seguro

```env
MEMED_REAL_ENABLED=false
MEMED_ALLOW_MOCK_FALLBACK=true
```

Redeploy staging. Production (`web`) **não** alterar neste runbook.

## Documentos relacionados

- [FLUXO-RECEITA-OFICIAL.md](./FLUXO-RECEITA-OFICIAL.md)
- [FASE4-MEMED-SANDBOX.md](./FASE4-MEMED-SANDBOX.md)
- [MEMED-REACT-ALIGNMENT.md](./MEMED-REACT-ALIGNMENT.md)
- [STAGING-FECHAMENTO-POS-E2E.md](./STAGING-FECHAMENTO-POS-E2E.md)
