# FASE PRÉ-PRODUÇÃO — Estabilização completa Doctor Prescreve

**Objetivo:** fluxo interno funcional, estável e validado **antes** da troca do número oficial Meta/WhatsApp e da abertura pública.

**Regra desta fase:** manter o número WhatsApp atual apenas para desenvolvimento/homologação interna.

**Prioridade:** estabilidade funcional > estética > cutover público.

---

## Estado atual (diagnóstico — 2026-05-31)

| # | Área | Status | Observação |
|---|------|--------|------------|
| 1 | Backend core | **PARCIAL** | Fase A codada: ingress auth, webhook Stripe, boot/readyz estritos; deploy Railway pendente |
| 2 | Banco Supabase | **PARCIAL** | Migração `20260530_webhook_events_idempotency.sql`; idempotência Supabase + fallback local só em dev |
| 3 | WhatsApp + n8n + Typebot | **PARCIAL** | Upload externo OK; n8n staging pode retornar 200 vazio; Baileys sem secret |
| 4 | Triagem clínica | **PARCIAL** | Motor elegibilidade HAS/DM/DLP/tireoide; validar edge cases |
| 5 | Stripe | **PARCIAL** | `POST /api/webhooks/stripe` confirma pagamento via metadata `atendimento_id`; Typebot ainda pode enviar `payment_status` até cutover |
| 6 | Painel médico | **PARCIAL** | `/fila`, prontuário, receita reais; `visualSim` só demo; auth só client-side |
| 7 | Prontuário | **PARCIAL** | Textos mockup + builder; expandir campos clínicos pendentes |
| 8 | Memed | **PARCIAL** | MdHub/Sinapse em `/receita`; sandbox vs mock conforme env |
| 9 | Entrega receita | **PARCIAL** | `POST /deliver` + `sendPrescription`; provider mock/Evolution em staging |
| 10 | E2E interno | **PARCIAL** | Backend 14/14 API; Playwright tour read-only; sem 15 passos panel+Memed auto |

**Nota:** não existem funções `enviarWhatsApp` / `enviarWhatsAppOficial` no código. Entrega = `sendPrescription()` em `mdoctor-backend/src/delivery/delivery.service.js`.

---

## Ordem de execução recomendada

Cada etapa só avança após critérios de aceite da anterior. **Commit separado por módulo.**

### Fase A — Fundação (bloqueadores)

**Implementado no repositório (2026-05-31):** A1–A3 em código; aplicar migration + vars no Railway antes de considerar fechada.

1. **A1 — Supabase obrigatório em staging/prod**
   - `DISABLE_LOCAL_DB_FALLBACK=true`
   - `/readyz` falha se Supabase indisponível
   - Chamar `assertProductionReady()` no boot em `NODE_ENV=production`

2. **A2 — Segurança de ingress**
   - Webhooks: `N8N_WEBHOOK_SECRET` obrigatório
   - `POST /api/atendimentos` / `POST /api/patients`: secret de serviço ou JWT conforme origem (n8n vs painel)
   - Idempotência webhook persistida (tabela `webhook_events`, não `Map` em memória)

3. **A3 — Stripe (backend)**
   - Webhook `checkout.session.completed` / `payment_intent.succeeded`
   - Atualizar `pagamento_status` + transição para fila
   - Metadata: `atendimento_id`, `telefone`, `protocol_version`

### Fase B — Fluxo paciente (WhatsApp → fila)

4. **B1 — n8n staging/prod**
   - Republicar workflow com `upload_url` no body
   - Menu opção 1 (atendimento) / opção 2 (suporte)
   - Alinhar `POST /api/whatsapp/webhook` (canônico)

5. **B2 — Typebot**
   - Triagem + elegibilidade + redirect pagamento
   - Sem `file input`; link upload externo

6. **B3 — Upload + fila**
   - Validar `awaiting_prescription_upload` → `waiting`
   - “RECEITA ANEXADA” no painel

### Fase C — Clínica + painel

7. **C1 — Protocolos elegibilidade**
   - HAS, DM2, DLP, hipotireoidismo: testes automatizados
   - Bloqueios, sinais de alerta, primeira prescrição

8. **C2 — Painel**
   - Fila real (sem `visualSim` em homologação)
   - Aprovar / reprovar / abrir prontuário / receita
   - Auth: considerar middleware Next ou validação server-side

9. **C3 — Prontuário**
   - Campos: identificação, queixa, HDA, medicações, alergias, triagem, conduta, decisão
   - Persistência em `dados_clinicos` / tabelas normalizadas (se schema expandido)

### Fase D — Memed + entrega

10. **D1 — Memed sandbox real**
    - `MEMED_ENABLED=true`, token, `prescription:completed` / callback
    - Unificar `integrations/memed.service` vs `services/memed.service`

11. **D2 — Entrega**
    - Salvar PDF/URL, status `ready` → `delivered`
    - WhatsApp dev (Evolution atual); **não** trocar número Meta nesta fase

### Fase E — E2E e go-live interno

12. **E1 — Roteiro E2E 15 passos** (manual + scripts API)
    - Documentar evidências em `docs/E2E-PRE-PROD-EVIDENCIAS.md`
    - Playwright: opcional para passos 8–11 (Memed permanece manual)

13. **E2 — Homologação sign-off**
    - Checklist GO-LIVE sem número novo
    - Preparar runbook troca número Meta (fase seguinte)

---

## Roteiro E2E interno (15 passos)

| # | Passo | Responsável | Automação atual |
|---|--------|-------------|-----------------|
| 1 | Paciente envia mensagem | WhatsApp dev + n8n | Manual |
| 2 | Chatbot responde | Typebot | Manual |
| 3 | Triagem inicia | Typebot | Manual |
| 4 | Paciente elegível | Backend `/api/eligibility` | Script |
| 5 | Pagamento gerado | Stripe (Typebot) | Manual |
| 6 | Pagamento aprovado | Stripe webhook (**a implementar**) | — |
| 7 | Entrada na fila | Webhook + Supabase | Script |
| 8 | Painel médico abre | `/fila` JWT | Playwright parcial |
| 9 | Prontuário abre | `/prontuario/:id` | Playwright parcial |
| 10 | Médico aprova | `clinical/approve` | Script homologação |
| 11 | Memed abre | `/receita` MdHub | **Manual** |
| 12 | Receita emitida | Callback Memed | Manual + API |
| 13 | Backend recebe receita | `POST /api/memed/receita` | Script |
| 14 | WhatsApp envia receita | `POST /deliver` | Mock/staging |
| 15 | Atendimento encerrado | `delivered` + audit | Script |

---

## Schema Supabase (alvo desta fase)

Migrações existentes: `supabase/migrations/20260527_*`, `20260528_*`, `20260529_*`.

**Expandir / consolidar tabelas:**

| Tabela | Uso |
|--------|-----|
| `pacientes` | Identificação, contato |
| `atendimentos` | Status, fila, pagamento |
| `triagens` | Payload Typebot, elegibilidade |
| `pagamentos` | Stripe ids, status |
| `decisoes_medicas` | Approve/reject + motivo |
| `receitas` | Memed pdf/url, metadados |
| `logs_auditoria` | Já parcial via audit store |
| `eventos_whatsapp` | Inbound/outbound |
| `webhook_events` | Idempotência |

Camada alvo: `mdoctor-backend/src/db/` (repositórios), stores apenas como thin wrapper.

---

## O que NÃO fazer nesta fase

- Trocar número oficial Meta / WhatsApp Business produção
- Abrir tráfego público sem sign-off E2E
- Refinar UI/ réplica visual pixel-perfect (já encerrada em `README-REPLICACAO.md`)
- Deploy produção sem `DISABLE_LOCAL_DB_FALLBACK` e secrets completos

---

## Commits sugeridos (um por módulo)

```
chore(db): migrar idempotência e webhook_events para Supabase
feat(stripe): webhook pagamento e atualização de fila
fix(auth): proteger POST atendimentos/patients com service secret
fix(whatsapp): alinhar delivery e webhook secret Baileys
feat(panel): middleware auth e fila sem visualSim em staging
test(e2e): roteiro 15 passos e scripts homologação
docs(ops): runbook pré-produção e evidências E2E
```

---

## Referências no repositório

| Doc | Conteúdo |
|-----|----------|
| `docs/OPERACIONAL-FECHAMENTO-FINAL.md` | Upload externo + E2E 14/14 |
| `docs/HOMOLOGACAO-CLINICA-FASE2.md` | Approve/reject/deliver/Memed |
| `docs/GO-LIVE-CHECKLIST.md` | Cutover produção |
| `docs/REPLICAÇÃO VISUAL DOCTOR PRESCREVE/README-REPLICACAO.md` | Mockup prontuário (encerrado) |
| `mdoctor-backend/scripts/staging-e2e-operacional.js` | E2E API 14 passos |
| `e2e/painel-tour.spec.ts` | Tour Playwright |

---

## Próximo passo imediato

**Iniciar Fase A1 + A2** (Supabase obrigatório, webhooks seguros, idempotência persistida), depois **A3 Stripe**.

Confirmar com o time qual ambiente executar primeiro: `mdoctor-backend-staging` no Railway.
