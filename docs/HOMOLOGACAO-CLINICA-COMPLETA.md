# Homologação clínica completa — Doctor Prescreve

Plano operacional pós-validação do fluxo **Typebot → n8n → triagem → fila médica**.

**Baseline validado:** ver `docs/HOMOLOGACAO-TYPEBOT-PRODUCAO.md`, `docs/OPERACAO-ASSISTIDA-TYPEBOT-PRODUCAO-RELATORIO.json`.

**Branch operacional:** `codex/legacy-compat-infra`  
**Backend produção:** `https://web-production-5f178.up.railway.app`  
**Painel staging (oficial para homologação UI):** `https://painel-medico-staging-staging.up.railway.app`  
**Painel produção (legado):** `https://web-production-02fde.up.railway.app` — usar staging até migração do painel.

---

## Fora de escopo (todas as fases)

- Stripe produção real
- Memed produção real (homologar em mock/sandbox primeiro)
- WhatsApp produção real
- Automações avançadas / billing / analytics / multi-tenant
- LGPD avançada / refactors amplos
- Alteração do fluxo Typebot/n8n já homologado

---

## Mapa de fases × código existente

| Fase | Objetivo | Já implementado | Gaps principais |
|------|-----------|-----------------|-----------------|
| **1** | Painel + prontuário + fila | `mdoctor-panel` (`/fila`, `/atendimento/[id]`, `/prontuario/[id]`), `GET /api/atendimentos?scope=medical`, guards `isVisibleInMedicalPanel` | Lock de atendimento, prioridade explícita, ordenação por SLA documentada |
| **2** | Aprovar / recusar | `POST .../clinical/approve`, `POST .../clinical/reject`, `clinical-decision.service.js`, logs `decisoes` + `audit` | Motivos estruturados (enum) no painel; webhook reprovação só staging documentado |
| **3** | Memed | `approveAtendimento` → `memed.createPrescription`, `/memed/[id]`, `POST .../clinical/validate`, `MEMED_ENABLED` | Homologação sandbox; travas medicamento controlado; PDF persistido em prod |
| **4** | Retorno paciente | `POST .../deliver` (whatsapp/email/sms), `DELIVERY_MOCK_ENABLED` | Canal produção WhatsApp; mensagem padrão pós-receita |
| **5** | Segurança | Rate limit triagem/whatsapp, idempotência, elegibilidade engine | Travas extras no approve; payload retention policy |
| **6** | Operação assistida | Scripts E2E staging, relatórios Typebot | Checklist médico por caso; métricas tempo médio |

---

## FASE 1 — Homologação do painel médico

### Endpoints e telas

| Recurso | Caminho |
|---------|---------|
| Fila (kanban) | `mdoctor-panel/src/app/fila/page.tsx` |
| Atendimento detalhado | `mdoctor-panel/src/app/atendimento/[id]/page.tsx` |
| Prontuário legado | `mdoctor-panel/src/app/prontuario/[id]/page.tsx` |
| Lista API fila médica | `GET /api/atendimentos?scope=medical` |
| Detalhe | `GET /api/atendimentos/:id` |
| Decisões | `GET /api/atendimentos/:id/decisoes` |
| URL receita anterior | `GET /api/atendimentos/:id/previous-prescription/view-url` (auth) |

### Critérios de aceite (checklist)

- [ ] Fila carrega apenas elegíveis + pagos + com receita (`scope=medical`)
- [ ] Colunas/status coerentes: waiting → em atendimento → ready → delivered/rejected
- [ ] Abertura do atendimento exibe: queixa, histórico, conduta, orientações, exame telemedicina
- [ ] Dados Typebot (`triagem_nested`, `typebot_variables`) visíveis no JSON clínico
- [ ] Link/visualização da receita anterior funciona
- [ ] Elegibilidade e `riskLevel` legíveis para o médico
- [ ] Edição de conduta/observação antes de decidir

### Probe automatizado (somente leitura)

```bash
node mdoctor-backend/scripts/homologacao-clinica-fase1-probe.js
```

Relatório: `docs/HOMOLOGACAO-CLINICA-FASE1-RELATORIO.json`

### Runbook manual

Ver `docs/RUNBOOK-HOMOLOGACAO-CLINICA-FASE1.md`.

---

## FASE 2 — Fluxo de aprovação médica

### Fluxo implementado

```txt
Fila → /atendimento/:id → APROVAR → memed_processing → /memed/:id → VALIDAR → ready
Fila → /atendimento/:id → REPROVAR → rejected → (n8n clinical-rejection-notify em staging)
```

### API

| Ação | Método | Auth |
|------|--------|------|
| Aprovar | `POST /api/atendimentos/:id/clinical/approve` | JWT médico |
| Reprovar | `POST /api/atendimentos/:id/clinical/reject` | JWT médico |
| Validar receita Memed | `POST /api/atendimentos/:id/clinical/validate` | JWT médico |

Documentação técnica: `docs/FASE1-APROVAR-REPROVAR-MEMED.md`.

### Tarefas de homologação

1. Validar guards de aprovação (`assertCanApprove`: pago, elegível, receita, foto).
2. Homologar reprovação com motivo livre; **evoluir** para motivos estruturados:
   - `sinais_alerta`
   - `documentacao_insuficiente`
   - `receita_ausente`
   - `medicacao_incompativel`
   - `fora_protocolo`
   - `suspeita_clinica`
3. Confirmar trilha: `createDecisaoLog` + `createAuditLog` + `clinical_audit` em `dados_clinicos`.

### Entregável sugerido (implementação futura, escopo mínimo)

- Constante `REJECT_REASON_CODES` no backend + select no painel (sem alterar Stripe/Memed).

---

## FASE 3 — Integração Memed

### Estado atual

- `mdoctor-backend/src/services/memed.service.js` (e integração legada)
- Aprovação dispara criação; mock quando `MEMED_ENABLED=false`
- Painel: `mdoctor-panel/src/app/memed/[id]/page.tsx`

### Homologação (sandbox primeiro)

1. `MEMED_ENABLED=true` + credenciais sandbox no **staging** apenas.
2. Caso: aprovar → receita gerada → PDF/URL em `dados_clinicos.memed_receita`.
3. Validar `clinical/validate` → status `ready`.
4. Bloqueios: reprovado não reabre Memed (`memed_bloqueado`).

**Não** homologar Memed produção real nesta fase.

---

## FASE 4 — Retorno ao paciente

### Estado atual

- `POST /api/atendimentos/:id/deliver` — canais `whatsapp` | `email` | `sms`
- Mock: `DELIVERY_MOCK_ENABLED=true` ou `NODE_ENV !== production`
- Reprovação: `n8n-clinical-notify.service.js` (staging)

### Homologação

1. Staging: entrega dry-run / mock com atendimento `ready`.
2. Mensagem + link PDF (quando existir `memed_receita.pdfUrl`).
3. Status final + timestamps em `dados_clinicos.entregas_receita`.

WhatsApp produção: **fase posterior**.

---

## FASE 5 — Segurança clínica e operacional

| Item | Status |
|------|--------|
| Rate limit `/api/webhook/triagem` | Implementado |
| Idempotência triagem | Implementado |
| Elegibilidade + pagamento na fila | Implementado |
| Logs estruturados (`logger`) | Parcial |
| Lock concorrência médico | **Não implementado** |
| Retry seguro n8n → backend | Manual (n8n config) |

Prioridade homologação: lock otimista por atendimento (`em_atendimento_por` + TTL) antes de escala multi-médico.

---

## FASE 6 — Homologação assistida

### Casos supervisionados (roteiro)

| # | Perfil | Esperado |
|---|--------|----------|
| 1 | HAS + losartana + receita OK | waiting → approve → memed → ready → deliver mock |
| 2 | Sinais de alerta | rejected na triagem ou reprova médica |
| 3 | Sem foto receita | fora da fila ou reprova na abertura |
| 4 | Pagamento pendente | fora da fila médica |

### Checklist por atendimento (operacional)

Ver seção final em `docs/RUNBOOK-HOMOLOGACAO-CLINICA-FASE1.md`.

---

## Ordem de execução recomendada

1. **Fase 1** — painel staging + probe + 2 casos reais na fila (somente leitura/decisão em staging).
2. **Fase 2** — approve/reject em staging com médico teste.
3. **Fase 3** — Memed sandbox no staging.
4. **Fase 4** — deliver mock.
5. **Fase 5** — lock + motivos estruturados (incremental).
6. **Fase 6** — piloto assistido produção (Typebot já OK) com painel staging apontando para backend prod **somente se** CORS e auth estiverem alinhados — preferir stack staging completa primeiro.

---

## Documentação relacionada

| Documento | Conteúdo |
|-----------|----------|
| `docs/RUNBOOK-HOMOLOGACAO-CLINICA-FASE1.md` | Passo a passo Fase 1 |
| `docs/FASE1-APROVAR-REPROVAR-MEMED.md` | Approve/reject/Memed |
| `docs/FLUXO-FOTO-RECEITA-SUPABASE.md` | Upload receita pós-webhook |
| `docs/RAILWAY-INFRA-AUDIT.md` | URLs Railway |
| `docs/HOMOLOGACAO-TYPEBOT-PRODUCAO.md` | Entrada paciente |

---

## Objetivo final

Operação assistida real com:

- decisão médica rastreável
- receita digital homologada (sandbox → prod controlado)
- retorno ao paciente verificável
- estabilidade do fluxo já validado (Typebot → fila)
