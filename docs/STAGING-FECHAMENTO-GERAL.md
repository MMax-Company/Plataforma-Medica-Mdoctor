# Fechamento geral — Doctor Prescreve Staging

**Data:** 2026-05-28  
**Branch de trabalho:** `codex/legacy-compat-infra`  
**Último commit staging:** `6751d4a` — *feat(staging): fechar Fases 1-3 — Typebot, painel, prontuário e deploy runbooks* (push em `codex/legacy-compat-infra`)

Este documento consolida o fechamento do ciclo staging após Fases 1–3. **Produção não foi alterada.**

---

## 1. Resumo executivo

| Área | Status | Observação |
|------|--------|------------|
| Export Typebot (local) | ✅ Validado | JSON staging-safe + consentimentos + fluxo reorganizado |
| Publicação Typebot (cloud) | ⏳ Pendente | `TYPEBOT_API_TOKEN` ausente nesta sessão |
| Workflows n8n (runtime) | ✅ Ativos | Webhook typebot responde 200; payload embutido no JSON |
| Republicação n8n (API) | ⏳ Pendente | `N8N_API_KEY` ausente nesta sessão |
| Backend staging | ✅ Online | `/health` 200; smokes API OK |
| Painel staging | ✅ Online | `/login` e `/dashboard` 200; build local OK |
| Código no Railway | ✅ Backend implantado | `railway up` 2026-05-29 — `terms_acceptance` confirmado; painel deploy disparado |
| Fluxo E2E WhatsApp real | ⏳ Manual | Requer teste humano no número Evolution staging |

---

## 2. Serviços staging (URLs)

| Serviço | URL |
|---------|-----|
| Backend | https://mdoctor-backend-staging-staging.up.railway.app |
| Painel | https://painel-medico-staging-staging.up.railway.app |
| n8n | https://n8n-staging-staging-2dfe.up.railway.app |
| Webhook Typebot → n8n | https://n8n-staging-staging-2dfe.up.railway.app/webhook/typebot-webhook |
| Evolution API | https://evolution-api-staging-staging-40d1.up.railway.app |
| Typebot (público) | https://typebot.co/doctor-prescreve-8rmljgu |

**Typebot interno:** `higij2z0xihxxkr378rmljgu` — `publicId` **doctor-prescreve-8rmljgu** (não criar bot novo).

---

## 3. Typebot

### Export pronto (repositório)

- `docs/typebot/typebot-doctor-prescreve-staging-safe.json`
- Espelho: `docs/typebot/typebot-export-doctor-prescreve-8rmljgu (5).json`
- Documentação: `docs/TYPEBOT-FLUXO-REORGANIZADO.md`

### Conteúdo validado localmente

- Fluxo reorganizado (elegibilidade → receita/foto disponível → termos → pagamento → medicamentos → upload foto → webhook)
- Documentos oficiais com **links amigáveis** (sem URL Supabase no texto)
- LGPD, Privacidade, Telemedicina assíncrona, Não urgência, Termos de uso
- Webhook **somente staging** (sem URLs de produção no JSON)
- Payload com consentimentos + medicamentos estruturados

### Publicação cloud

**Não executada nesta sessão** — falta `TYPEBOT_API_TOKEN` no ambiente.

```bash
# Após definir o token (não commitar):
export TYPEBOT_API_TOKEN=***
node mdoctor-backend/scripts/patch-typebot-reorganize.js
node mdoctor-backend/scripts/validate-typebot-staging-safe.js
node mdoctor-backend/scripts/publish-typebot-staging.js
```

---

## 4. n8n — workflows staging

| Workflow | Arquivo | Função |
|----------|---------|--------|
| `typebot-webhook-staging` | `docs/n8n-workflows/typebot-webhook-staging.json` | Normaliza payload → backend `/api/whatsapp/webhook` |
| `clinical-rejection-notify-staging` | `docs/n8n-workflows/clinical-rejection-notify-staging.json` | WhatsApp após reprovação clínica |
| `Evolution Webhook - Staging` | `docs/n8n-workflows/evolution-webhook-staging.json` | Menu WhatsApp + roteamento Typebot/suporte |

### Estado

- Normalizador embutido: `node mdoctor-backend/scripts/embed-n8n-typebot-payload.js` ✅
- **Smoke:** `POST /webhook/typebot-webhook` → **200** ✅
- **Republicação via API:** não executada (`N8N_API_KEY` ausente). Workflows em runtime parecem ativos.

```bash
export N8N_API_KEY=***
export N8N_WORKFLOW_FILE=docs/n8n-workflows/typebot-webhook-staging.json
node mdoctor-backend/scripts/deploy-n8n-workflow.js
# Repetir para clinical-rejection-notify-staging.json e evolution-webhook-staging.json
```

---

## 5. Backend staging

### Validações locais (código no repo)

| Teste | Resultado |
|-------|-----------|
| `validate-typebot-staging-safe.js` | ✅ |
| `test-typebot-eligibility.js` | ✅ |
| `test-fase1-payload-normalizer.js` | ✅ |

### Smoke HTTP (ambiente staging remoto)

| Teste | Resultado |
|-------|-----------|
| `GET /health` | ✅ 200 |
| Elegível + pago → fila `waiting` | ✅ |
| Não pago → `rejected` | ✅ |
| Sem foto → `rejected` | ✅ |
| n8n webhook alcançável | ✅ 200 |

```bash
export N8N_WEBHOOK_SECRET=***   # já disponível nesta máquina
node mdoctor-backend/scripts/smoke-fase1-staging.js
```

### Funcionalidades implementadas (código local — aguarda deploy)

- Normalização clínica + eligibility engine
- Termos/consentimentos em `dados_clinicos.terms_acceptance` e `clinical_audit`
- Suporte WhatsApp separado (`queue_type: support`)
- Fila médica protegida (pago + elegível + foto)
- Prontuário, aprovar/reprovar, Memed mock, entrega WhatsApp/e-mail/SMS
- Anti-duplicidade de webhook e entrega

### Redeploy

Railway CLI autenticado (`Doctor Markenting`). **Recomendado após commit/push:**

- Projeto backend: `Backend-Mdoctor` → serviço `mdoctor-backend-staging`
- Root: `mdoctor-backend`

---

## 6. Painel staging

### Build local (2026-05-28)

| Comando | Resultado |
|---------|-----------|
| `npm run lint` | ✅ 0 erros, 2 warnings (`react-hooks/exhaustive-deps`) |
| `npm run build` | ✅ Next.js 14 — 13 rotas (limpar `.next` se EINVAL/OneDrive no Windows) |

### Remoto

- https://painel-medico-staging-staging.up.railway.app/login → **200**
- https://painel-medico-staging-staging.up.railway.app/dashboard → **200**

### UI implementada (código local — aguarda deploy)

- Logo oficial, cabeçalho unificado, faixa Suporte Médico via WhatsApp
- Fila minimalista, Em atendimento (Memed), Receitas prontas
- Prontuário tela cheia, aprovar/reprovar, envio final

**Variável crítica:** `NEXT_PUBLIC_API_URL` → backend staging.

### Redeploy

- Projeto: `Painel-MDoctor` → serviço `painel-medico-staging`

---

## 7. Status e filas (regras)

| Status | Uso |
|--------|-----|
| `support` | Suporte WhatsApp — **não** entra na fila médica |
| `waiting` | Fila médica |
| `memed_processing` | Em atendimento / validação Memed |
| `ready` | Receitas prontas |
| `delivered` | Envio concluído — sai das colunas operacionais |
| `rejected` | Inelegível / reprovado — **não** aciona Memed |

Validado em smokes de API: inelegível/não pago → `rejected`; elegível pago → `waiting`.

---

## 8. Termos e consentimentos (payload)

Campos no webhook / normalizador:

- `lgpd_accepted`, `privacy_policy_accepted`
- `telemedicine_consent_accepted`, `non_urgency_notice_accepted`
- `terms_of_use_accepted`
- `accepted_terms_at`, `accepted_terms_links`
- `typebot_public_id` = `doctor-prescreve-8rmljgu`

Persistência backend: `dados_clinicos.terms_acceptance`, `dados_clinicos.clinical_audit`.

---

## 9. Bloqueios validados (API smoke)

| Cenário | Esperado | Smoke |
|---------|----------|-------|
| Não pago | `rejected`, fora da fila | ✅ |
| Sem foto da receita | `rejected` | ✅ |
| Elegível + pago + foto | `waiting` | ✅ |
| LGPD / alerta / &lt;30 dias / sem receita | Typebot (pré-pagamento) | ✅ JSON + testes locais |
| Duplicidade webhook/entrega | 409 / idempotência | ✅ código (teste manual recomendado) |

---

## 10. Variáveis de ambiente (checklist)

### Obrigatórias para fechamento completo

| Variável | Onde | Status nesta sessão |
|----------|------|---------------------|
| `TYPEBOT_API_TOKEN` | CI/local publish | ❌ Ausente |
| `N8N_API_KEY` | Republicação n8n | ❌ Ausente |
| `N8N_WEBHOOK_SECRET` | n8n + backend | ✅ Presente (smokes OK) |
| `JWT_SECRET` | Backend Railway | ⚠️ Confirmar no Railway |
| `NEXT_PUBLIC_API_URL` | Painel Railway | ⚠️ Confirmar aponta para backend staging |

### Integrações

| Variável | Uso |
|----------|-----|
| `TYPEBOT_PUBLIC_ID` | `doctor-prescreve-8rmljgu` |
| `TYPEBOT_PUBLIC_URL` | `https://typebot.co/doctor-prescreve-8rmljgu` |
| `N8N_CLINICAL_REJECT_WEBHOOK_URL` | Reprovação → WhatsApp |
| `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` | Evolution staging |
| `MEMED_*` | Mock em staging |
| `SUPABASE_*` | Storage/documentos |
| `STRIPE_*` | Pagamento Typebot (staging) |

Referência: `mdoctor-backend/.env.example`, `mdoctor-backend/.env.staging.example`

---

## 11. Pendências reais

1. ~~**Commit + push**~~ ✅ `6751d4a` em `codex/legacy-compat-infra` — confirmar deploy Railway backend + painel.
2. **Publicar Typebot** com `publish-typebot-staging.js` + token (**passo 2/5**).
3. **Republicar 3 workflows n8n** com `deploy-n8n-workflow.js` (ou UI n8n) após embed do payload.
4. **Confirmar redeploy** Railway backend + painel após push `6751d4a` (**passo 4/5**).
5. **Teste manual WhatsApp** ponta a ponta: menu → Typebot → pagamento → upload → painel → Memed → entrega.
6. Confirmar **Stripe staging** no bloco de pagamento Typebot após publicação.

---

## 12. Riscos restantes

- **Drift código/deploy:** até o Railway concluir deploy de `6751d4a`, staging pode ainda servir build anterior.
- **Typebot cloud desatualizado** até rodar publish com token.
- **n8n** pode estar com workflow antigo se não republicar após mudanças no normalizador.
- **E2E WhatsApp** não automatizado nesta sessão (depende Evolution + número real).
- **2 warnings ESLint** no painel — não bloqueiam build.

---

## 13. Próximos passos para produção

1. Replicar variáveis e workflows em ambiente de produção **somente após** homologação staging completa.
2. Trocar URLs de webhook Typebot para n8n produção (nunca misturar staging/prod no mesmo bot).
3. Ativar Memed real, Stripe live e WhatsApp oficial com checklist separado.
4. Revisão jurídica dos PDFs em Supabase Storage.
5. Monitoramento e auditoria (`clinical_audit`, `audit_logs`) em produção.

---

## 14. Comandos úteis

```bash
# Fechamento automatizado (gera docs/STAGING-FECHAMENTO-GERAL.json)
node mdoctor-backend/scripts/staging-fechamento-geral.js

# Validação Typebot
node mdoctor-backend/scripts/patch-typebot-reorganize.js
node mdoctor-backend/scripts/validate-typebot-staging-safe.js

# Smoke staging
node mdoctor-backend/scripts/smoke-fase1-staging.js

# Painel
cd mdoctor-panel && npm run lint && npm run build
```

---

## 15. Conclusão

O **staging está operacional** no que já foi deployado (backend, painel, n8n webhook, smokes API). O **ciclo de fechamento local está completo** (Typebot JSON, testes, build painel, documentação).

Para **encerrar o ciclo staging com o código das Fases 1–3 em produção de staging**, faltam apenas: **publicar Typebot**, **republicar n8n**, **push + redeploy Railway** e **um teste manual WhatsApp** de confirmação.
