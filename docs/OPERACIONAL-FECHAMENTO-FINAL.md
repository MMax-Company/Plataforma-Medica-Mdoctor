# Fechamento operacional final — Upload externo da receita

**Atualizado:** 2026-05-29 (fechamento automático staging)  
**Supabase:** `thbwoogytwcidxrrboym`

---

## Resumo executivo

| Área | Status |
|------|--------|
| Upload externo (sem Typebot `file input`) | ✅ |
| Bucket `receitas-anteriores` | ✅ |
| Backend staging + variáveis Railway | ✅ |
| Redeploy backend staging | ✅ (Railway) |
| Página `/upload-receita/[token]` (painel) | ✅ no repositório; redeploy painel solicitado |
| Fila: `awaiting_prescription_upload` → `waiting` | ✅ |
| Typebot staging publicado (plano free) | ✅ sem `file input` |
| n8n staging — JSON no repo | ✅ |
| n8n staging — deploy via API | ⚠️ `N8N_API_KEY` staging retornou 401 |
| n8n staging — resposta `upload_url` ao Typebot | ⚠️ webhook responde 200 com corpo vazio até republicar workflow |
| Testes automatizados | ✅ `test-external-upload-flow.js` + E2E **14/14** |
| n8n produção legado (`triagens`) | ⏸️ fora de escopo (cutover futuro) |

---

## Fluxo definitivo

```
Typebot (confirma receita, sem arquivo)
  → medicamentos → confirmação → webhook n8n
  → POST /api/whatsapp/webhook
  → upload_url + status awaiting_prescription_upload
  → paciente: {UPLOAD_PAGE_BASE_URL}/upload-receita/{token}
  → POST /api/upload-receita/{token}
  → Supabase receitas-anteriores + metadados
  → waiting → painel médico (“RECEITA ANEXADA”)
```

---

## Variáveis Railway (backend `mdoctor-backend-staging`)

Definidas via `node mdoctor-backend/scripts/set-railway-staging-upload-env.js`:

| Variável | Valor |
|----------|--------|
| `PRESCRIPTION_EXTERNAL_UPLOAD` | `true` |
| `UPLOAD_PAGE_BASE_URL` | `https://painel-medico-staging-staging.up.railway.app` |
| `PUBLIC_BASE_URL` | `https://mdoctor-backend-staging-staging.up.railway.app` |
| `PRESCRIPTION_UPLOAD_TOKEN_TTL_MS` | `86400000` (24 h) |
| `SUPABASE_BUCKET_RECEITAS_ANTERIORES` | `receitas-anteriores` |

---

## Endpoints (staging)

| Rota | Método | Uso |
|------|--------|-----|
| `/api/whatsapp/webhook` | POST | Triagem; retorna `upload_url` quando aguardando foto |
| `/upload-receita/:token` | GET | Página HTML de upload (backend) |
| `/api/upload-receita/:token` | POST | Multipart `file` (jpg/jpeg/png/pdf, máx. 10 MB) |
| `/api/upload-receita/:token/status` | GET | Status da sessão / token |
| `/api/atendimentos/:id/previous-prescription/view-url` | GET | Signed URL (JWT médico) |

Painel (sem login médico): `https://painel-medico-staging-staging.up.railway.app/upload-receita/{token}`

---

## Typebot (staging publicado)

- **Bot:** `higij2z0xihxxkr378rmljgu` / público `doctor-prescreve-8rmljgu`
- **Publish:** `node mdoctor-backend/scripts/patch-typebot-external-upload.js` + `publish-typebot-staging.js`
- **Removido:** bloco `file input`
- **Ordem:** medicamentos → confirmação → webhook → tela “Enviar foto da receita” (`{{upload_url}}`)
- **Mapeamento:** `responseVariableMapping` → variável `upload_url` (`bodyPath: upload_url`)

Mensagem na tela de upload:

> Para concluir sua solicitação, envie agora a foto da sua receita anterior. Seu atendimento só será encaminhado para análise médica após o envio da imagem.

---

## n8n staging

- Workflow: `docs/n8n-workflows/typebot-webhook-staging.json`
- Lib: `docs/n8n-workflows/lib/typebot-webhook-payload.code.js` (não exige `previous_prescription_file`)
- Node **Wrap Response** deve retornar `upload_url` do backend

**Republicar (obrigatório para Typebot receber o link):**

```bash
export N8N_API_KEY="<chave API do n8n-staging>"
export N8N_BASE_URL="https://n8n-staging-staging-2dfe.up.railway.app"
export N8N_WORKFLOW_FILE="docs/n8n-workflows/typebot-webhook-staging.json"
node mdoctor-backend/scripts/embed-n8n-typebot-payload.js
node mdoctor-backend/scripts/deploy-n8n-workflow.js
```

Validar:

```bash
curl -s -X POST https://n8n-staging-staging-2dfe.up.railway.app/webhook/typebot-webhook \
  -H "Content-Type: application/json" \
  -d '{"whatsapp":"5511999990001","Nome_Completo":"Teste","has_previous_prescription":"sim","payment_status":"paid","medication_count":1,"med1_nome":"Losartana"}'
# Esperado: JSON com upload_url não vazio
```

---

## Fila médica

| Situação | Status | Painel médico |
|----------|--------|----------------|
| Elegível + pago + sem upload | `awaiting_prescription_upload` | Não aparece |
| Upload válido | `waiting` | Entra na fila |
| Upload inválido / token expirado | — | Não entra |
| Suporte WhatsApp | fila suporte | Separado |
| Inelegível / não pago | `rejected` / bloqueado | Não entra |

---

## Supabase Storage

| Item | Valor |
|------|--------|
| Bucket | `receitas-anteriores` |
| Path | `atendimentos/{atendimento_id}/receita-anterior-{timestamp}.{ext}` |
| Metadados | `previous_prescription_*`, `previous_prescription_source=external_upload` |

---

## Validação executada (2026-05-29)

```bash
cd mdoctor-backend
node scripts/test-external-upload-flow.js          # OK
node scripts/staging-e2e-operacional.js            # 14/14 OK
node scripts/validate-typebot-staging-safe.js      # OK (sem file input)
```

---

## Pendências reais (somente estas)

1. **n8n staging:** importar/republicar `typebot-webhook-staging.json` com `N8N_API_KEY` válida do serviço `n8n-staging` (API retornou 401 com a chave local usada). Sem isso, o Typebot não recebe `upload_url` no webhook (corpo HTTP vazio hoje).
2. **n8n produção:** cutover do workflow legado que grava em `triagens` — **não alterado** neste fechamento.
3. **Teste manual WhatsApp:** triagem completa no número Evolution staging após item 1.

Detalhes técnicos: [`FLUXO-FOTO-RECEITA-SUPABASE.md`](FLUXO-FOTO-RECEITA-SUPABASE.md)
