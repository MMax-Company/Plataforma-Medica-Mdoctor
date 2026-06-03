# Go Live Assistido — Checklist Master

Preparação para **operação médica assistida controlada** do Doctor Prescreve.

**Estado atual (2026-05-29):** Fase 2 concluída em staging (E2E API). Fases 3–6 abaixo são os gates antes do primeiro atendimento real supervisionado.

---

## Ambientes de referência

| Papel | URL / serviço Railway |
|-------|------------------------|
| Backend staging | `https://mdoctor-backend-staging-staging.up.railway.app` |
| Painel staging | `https://painel-medico-staging-staging.up.railway.app` |
| n8n staging | `https://n8n-staging-staging-2dfe.up.railway.app` |
| Typebot (operação assistida prod) | `https://typebot.co/doctor-prescreve-8rmljgu` |
| Evidência Fase 2 | `docs/HOMOLOGACAO-CLINICA-FASE2-RELATORIO.json` |

**Não usar ainda:** Memed produção total, WhatsApp massivo, Stripe billing avançado, escala comercial.

---

## Gate 0 — Pré-requisitos (concluídos)

- [x] Fila médica operacional (Typebot → n8n → backend)
- [x] Prontuário automático + elegibilidade
- [x] Approve / reject com motivos estruturados
- [x] Memed **mock** + validate + deliver mock
- [x] Audit mínimo (`createAuditLog`)
- [x] E2E staging (`node mdoctor-backend/scripts/fechar-fase2-staging.js`)

---

## Fase 3 — Sign-off operacional (manual)

**Objetivo:** validar UX e fluxo médico no painel staging.

**Automação API:** `node mdoctor-backend/scripts/sign-off-fase3-staging.js` → `docs/SIGN-OFF-FASE3-RELATORIO.md`

**Ordem:** API verde **não substitui** assinatura manual UX.

### 3.1 Fluxo visual

| # | Passo | OK | Responsável | Data |
|---|--------|-----|-------------|------|
| 1 | Login médico staging | [ ] | | |
| 2 | Fila — só elegíveis/pagos com receita | [ ] | | |
| 3 | Abrir `/atendimento/{id}` — prontuário completo | [ ] | | |
| 4 | Visualizar receita anterior | [ ] | | |
| 5 | **Aprovar** → `memed_processing` (não PATCH status) | [ ] | | |
| 6 | Validar receita → `ready` | [ ] | | |
| 7 | Entregar (mock) → `delivered` | [ ] | | |
| 8 | Novo caso — **Reprovar** com motivo estruturado | [ ] | | |
| 9 | Prontuário `/prontuario/{id}` — approve/reject | [ ] | | |

**IDs de teste (Fase 2):** approve `11ccc0ac-fc66-42ad-b266-4009ebdf39db` · reject `a930e2af-2652-4487-9918-d8f9dfdf0a89`

### 3.2 UX médica

- [ ] Clareza de conduta, medicação, risco, pagamento
- [ ] Tempo aceitável fila → decisão (< 5 min em caso simples)
- [ ] Sem erro de navegação (voltar, refresh, logout)
- [ ] Mensagens de erro compreensíveis (422 approve sem receita, etc.)

### 3.3 Concorrência mínima

| Cenário | Esperado hoje | OK |
|---------|----------------|-----|
| Dois médicos, mesmo atendimento | **Sem lock distribuído** — risco de decisão dupla | [ ] Procedimento: 1 médico por fila no go-live |
| Refresh simultâneo no mesmo ID | Última escrita vence | [ ] |
| Dois médicos, atendimentos diferentes | OK | [ ] |

**Gap conhecido:** não há `lock` de atendimento no backend. Go-live assistido = **um médico ativo na fila** até implementar lock (Fase futura).

### 3.4 Falhas comuns (simular em staging)

| Falha | Como simular | Resultado esperado | OK |
|-------|----------------|-------------------|-----|
| Receita ausente | Triagem sem `foto_receita_url` | Não entra na fila ou approve 422 | [ ] |
| Pagamento ausente | `pagamento_status` ≠ CONFIRMADO | Rejeitado / fora da fila | [ ] |
| Dados incompletos | Triagem sem doença/medicação | Elegibilidade negativa | [ ] |
| Upload inválido | Token upload expirado / arquivo grande | Erro claro no upload | [ ] |
| Timeout Memed | `MEMED_TIMEOUT_MS=1` temporário | Fallback mock + warning, fluxo não quebra | [ ] |

**Runbook detalhado:** `docs/OPERACAO-ASSISTIDA-GUIDE.md` · sign-off: `docs/RUNBOOK-SIGN-OFF-FASE3.md` (criar assinatura no final do runbook Fase 3)

---

## Fase 4 — Memed sandbox real

**Objetivo:** credenciais sandbox, prescrição real persistida, sem produção Memed.

| # | Item | OK |
|---|------|-----|
| 1 | `MEMED_API_KEY` + `MEMED_SECRET_KEY` (sandbox) no Railway staging | [ ] |
| 2 | `MEMED_ENV` / `MEMED_ENVIRONMENT` = `sandbox` ou `development` (**não** `production`) | [ ] |
| 3 | `MEMED_ENABLED=true` | [ ] |
| 4 | `GET /readyz` → `memed.source=memed` | [ ] |
| 5 | Approve gera `source: memed` (não só mock) | [ ] |
| 6 | PDF/link acessível pelo médico | [ ] |
| 7 | Bloqueio clínico em reject (`memed_bloqueado`) mantido | [ ] |

**Referência:** `docs/MEMED-CONTROLLED-VALIDATION.md` · `mdoctor-backend/.env.production.example`

---

## Fase 5 — Observabilidade e segurança

| # | Item | OK |
|---|------|-----|
| 1 | Logs/audit: triagem, approve, reject, validate, deliver | [ ] |
| 2 | Health probe: `node mdoctor-backend/scripts/go-live-health-probe.js` | [ ] |
| 3 | Alertas mínimos definidos (manual ou Railway) | [ ] |
| 4 | Rollback documentado e testado em staging | [ ] |

**Detalhe:** `docs/OBSERVABILIDADE-MINIMA.md` · `docs/ROLLBACK-PLAN.md`

---

## Fase 6 — Documentação operacional

- [x] `docs/GO-LIVE-CHECKLIST.md` (este arquivo)
- [x] `docs/OPERACAO-ASSISTIDA-GUIDE.md`
- [x] `docs/ROLLBACK-PLAN.md`
- [x] `docs/OBSERVABILIDADE-MINIMA.md`

---

## Critérios finais de Go Live assistido

Só iniciar **atendimentos reais supervisionados** quando **todos** estiverem marcados:

- [ ] Fase 3 — sign-off manual assinado
- [ ] Fase 3 — falhas comuns validadas
- [ ] Fase 3 — procedimento de concorrência aceito (1 médico / fila)
- [ ] Fase 4 — Memed sandbox OK
- [ ] Fase 5 — health probe verde + rollback ensaiado
- [ ] Responsável médico + responsável técnico nomeados
- [ ] Janela de rollback acordada (ver `ROLLBACK-PLAN.md`)

---

## Comandos rápidos

```bash
# E2E clínico staging
cd mdoctor-backend && node scripts/fechar-fase2-staging.js

# Saúde dos serviços
node scripts/go-live-health-probe.js

# Operação assistida Typebot (produção controlada)
node mdoctor-backend/scripts/verificar-operacao-assistida-typebot.js
```

---

## Fora de escopo (explícito)

- Escala comercial / marketing pesado
- Múltiplos médicos simultâneos sem lock
- Billing Stripe avançado
- WhatsApp produção em massa
- Memed produção total
- Automações agressivas / LGPD avançada
