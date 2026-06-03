# Staging deploy 2/2 — Runbook operacional

Plano em **5 passos** para encerrar 100% o staging (após validação 1/2 concluída).

| Passo | Ação | Automático | Pré-requisito |
|-------|------|------------|---------------|
| **1/5** | Validação local (Typebot, testes, build painel) | `staging-fechamento-geral.js` | — |
| **2/5** | Publicar Typebot cloud | `publish-typebot-staging.js` | `TYPEBOT_API_TOKEN` |
| **3/5** | Republicar 3 workflows n8n | `deploy-n8n-workflow.js` × 3 | `N8N_API_KEY` |
| **4/5** | Commit + push + redeploy Railway | git + Railway | branch `codex/legacy-compat-infra` |
| **5/5** | Teste manual WhatsApp E2E | Humano | Evolution + número staging |

## 2/5 — Typebot

```bash
export TYPEBOT_API_TOKEN="***"
export TYPEBOT_ID="higij2z0xihxxkr378rmljgu"
node mdoctor-backend/scripts/patch-typebot-reorganize.js
node mdoctor-backend/scripts/validate-typebot-staging-safe.js
node mdoctor-backend/scripts/publish-typebot-staging.js
```

Confirmar em https://typebot.co/doctor-prescreve-8rmljgu

## 3/5 — n8n

```bash
export N8N_API_KEY="***"
export N8N_BASE_URL="https://n8n-staging-staging-2dfe.up.railway.app"

for f in typebot-webhook-staging clinical-rejection-notify-staging evolution-webhook-staging stripe-payment-staging prescription-delivery-staging; do
  export N8N_WORKFLOW_FILE="docs/n8n-workflows/${f}.json"
  node mdoctor-backend/scripts/deploy-n8n-workflow.js
done
```

## 4/5 — Git + Railway

```bash
git push -u origin codex/legacy-compat-infra
```

Railway (se não houver deploy automático pelo Git):

- Backend: projeto `Backend-Mdoctor`, serviço `mdoctor-backend-staging`, root `mdoctor-backend`
- Painel: projeto `Painel-MDoctor`, serviço `painel-medico-staging`, root `mdoctor-panel`

Smoke pós-deploy:

```bash
export N8N_WEBHOOK_SECRET="***"
node mdoctor-backend/scripts/smoke-fase1-staging.js
```

## 5/5 — Checklist WhatsApp manual

- [ ] Enviar mensagem ao número Evolution staging
- [ ] Menu: opção renovação → abre Typebot
- [ ] LGPD + documentos (links amigáveis) → Autorizo
- [ ] Triagem completa → termos → pagamento (Stripe staging)
- [ ] Medicamentos + upload foto receita
- [ ] Paciente aparece na **fila médica** do painel (não em suporte)
- [ ] Prontuário → aprovar → Memed → receitas prontas → envio WhatsApp/e-mail/SMS → `delivered`
- [ ] Repetir bloqueio: recusar LGPD / sinal alerta / sem receita (não deve cobrar nem entrar na fila)

## Script único (quando tokens existirem)

```bash
export TYPEBOT_API_TOKEN=***
export N8N_API_KEY=***
export N8N_WEBHOOK_SECRET=***
node mdoctor-backend/scripts/staging-deploy-2-2.js
```
