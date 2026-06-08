# Fase Integração Painel — Relatório Completo

**Gerado:** 2026-06-07T05:51:48.552Z  
**Ambiente:** STAGING/HOMOLOGAÇÃO (nunca produção)  
**Painel:** https://painel-medico-staging-staging.up.railway.app/fila  
**Backend:** https://mdoctor-backend-staging-staging.up.railway.app  

---

## 1. Estado das integrações

| # | Integração | Veredito | Evidência |
|---|------------|----------|-----------|
| 1 | Frontend → Backend | **OK** | Painel `/login` 200; login JWT 200; `/health` 200 |
| 2 | Backend → Supabase | **OK** | `/readyz`: configured + connected, mode supabase, storage responding |
| 3 | Backend → Fila | **OK** | `GET /api/atendimentos/queue` 200, 75→80 registros após seed |
| 4 | Backend → Prontuário | **OK** | `GET /api/atendimentos/:id` 200; `PATCH /:id/clinical` persiste |
| 5 | Backend → Aprovação/Reprovação | **OK** | approve 200 + Memed; reject 200 com `reason_code` válido |
| 6 | Backend → Memed | **OK** | configured real_mode; `GET /api/memed/token` 200 |
| 7 | Backend → WhatsApp | **OK** | `GET /api/whatsapp/status` 200 |
| 8 | Backend → Evolution API | **PARCIAL** | Evolution HTTP 200; provider não reporta `evolution configured` |
| 9 | Backend → n8n | **PARCIAL** | `/healthz` 200; webhook typebot POST 404 (path staging) |
| 10 | Backend → Typebot | **OK** | Typebot público 200; ingress `/api/webhook/triagem` responde 400 (esperado sem payload) |

---

## 2. Diagnóstico da fila (OBJETIVO 2)

### Snapshot antes do seed TESTE 11–15

| Coluna (API) | Qtd | Observação |
|--------------|-----|------------|
| FILA DE ESPERA | 11 | **100% eram suporte WhatsApp** (`condicao=suporte_whatsapp`) |
| EM ATENDIMENTO | 23 | Maioria `approved` de testes anteriores |
| RECEITAS PRONTAS | 1 | `receita_emitida` |
| FINALIZADOS | 40 | Rejeitados pagos mergeados |

### Por que a FILA DE ESPERA aparece vazia no painel

1. **Filtro frontend de suporte** — `fila/page.tsx` exclui `suporte_whatsapp` / `queue_type=support` das 3 colunas médicas. Os 11 `waiting` da API iam todos para a banda de suporte, **não para a coluna amarela**.
2. **ATENDER move imediatamente** — botão faz `PATCH EM_ATENDIMENTO` ao abrir modal; paciente sai da fila na mesma ação.
3. **Acúmulo em EM ATENDIMENTO** — status `approved` pós-approve mapeia para coluna amarela (`EM_ATENDIMENTO`), não verde; 23 registros históricos de homologações.
4. **Visibilidade backend** — `isVisibleInMedicalPanel()` exige: pago + elegível + foto receita + não suporte. Pacientes sem foto não aparecem em nenhuma coluna médica.
5. **Sem erro de sync** — frontend consome o mesmo `/queue`; a divergência é **filtro intencional suporte + mapeamento de colunas**, não falha de polling.

### Filtros aplicados

**Backend (`GET /queue`):**
- `pagamento_status === CONFIRMADO`
- `isClinicallyEligible()` (eligible ou risco BAIXO)
- `isVisibleInMedicalPanel()` (foto receita, não suporte, não awaiting upload)
- Exclui `delivered`/`cancelado`; merge rejeitados pagos

**Frontend (`/fila`):**
- Exclui itens de suporte das colunas médicas
- Coluna FILA: `QUEUE | FILA | TRIAGED` (backend: `waiting`, `queue`, `triaged`)
- Coluna EM ATENDIMENTO: `EM_ATENDIMENTO | UNDER_REVIEW | MEMED_PROCESSING | AWAITING_VALIDATION` (+ `approved` via mapper)
- Polling 30s; filtros UI opcionais (search, status, risco, pagamento)

---

## 3. Estado Supabase

- Configurado: **sim**
- Conectado: **sim**
- Modo persistência: **supabase** (sem fallback local)
- Buckets: documents, receitas, receitas-anteriores, medical-records, consents, logs

---

## 4. Pacientes TESTE 11–15 criados

| # | Nome | ID | CPF | Telefone | E-mail | Status inicial |
|---|------|----|-----|----------|--------|----------------|
| 11 | PACIENTE TESTE 11 | `d3558391-d39a-4c5a-92b6-f0abc2ba5c7b` | 52998224725 | +5511999110011 | homolog.teste11@mdoctor.local | waiting ✅ |
| 12 | PACIENTE TESTE 12 | `9103258e-6663-4006-bdfa-46c008d145ee` | 11144477735 | +5511999110012 | homolog.teste12@mdoctor.local | waiting ✅ |
| 13 | PACIENTE TESTE 13 | `74d799c3-2c21-4f11-9578-4758add23cea` | 39053344705 | +5511999110013 | homolog.teste13@mdoctor.local | waiting → rejected* |
| 14 | PACIENTE TESTE 14 | `f982361b-daa1-4bd9-97c9-fa778c7f18b9` | 28625587896 | +5511999110014 | homolog.teste14@mdoctor.local | waiting ✅ |
| 15 | PACIENTE TESTE 15 | `e9a6a871-1284-4ee6-b3cb-e27e682dad09` | 81717023088 | +5511999110015 | homolog.teste15@mdoctor.local | waiting → approved* |

\*Alterados pelos testes operacionais automatizados.

Todos marcados com `homologacao_painel=true`, pagamento CONFIRMADO, elegíveis, foto receita fictícia, prontuário mínimo válido.

---

## 5. Testes operacionais (API — espelha fluxo do painel)

| # | Teste | Resultado | Evidência |
|---|-------|-----------|-----------|
| 1 | ATENDER | ✅ OK | TESTE 15: `waiting` → `em_atendimento` (PATCH 200) |
| 2 | Abrir modal / prontuário | ✅ OK | GET atendimento 200, dados clínicos presentes |
| 3 | Editar prontuário | ✅ OK | PATCH `/clinical` 200, histórico persistido no Supabase |
| 4 | Aprovar | ✅ OK | POST `/clinical/approve` 200, status `approved`, Memed present |
| 5 | Reprovar | ⚠️ PARCIAL | Script usou reason_code inválido (400). **Reteste TESTE 13** com `FORA_DO_PROTOCOLO`: 200, `rejected` |
| 6 | Atualização da fila | ✅ OK | 5 TESTE visíveis; contagem reflete mudanças de status |
| 7 | Mudança de status | ✅ OK | `approved` → coluna EM ATENDIMENTO no painel |
| 8 | Persistência banco | ✅ OK | Re-leitura após 500ms confirma dados |

**Estado atual dos TESTE na fila:** 11 e 12 em FILA DE ESPERA; 14 em EM ATENDIMENTO (prep reject); 15 approved; 13 rejected.

---

## 6. Problemas encontrados

1. FILA visualmente vazia quando só existem tickets de suporte WhatsApp em `waiting`.
2. Acúmulo de 23+ pacientes `approved` em EM ATENDIMENTO (resíduo de homologações).
3. Reject exige `reason_code` enum específico (documentar no script de teste).
4. Evolution/n8n: infra responde, mas cadeia completa WhatsApp→Evolution→n8n não validada end-to-end nesta execução.

---

## 7. Recomendações — próxima etapa

1. **Teste humano no painel staging** `/fila` (sem `visualSim`) — validar modal, ATENDER, approve/reject na UI.
2. **Limpar staging** — arquivar ou remover pacientes TESTE 01–15 e massas antigas após homologação.
3. **Separar filas** — considerar endpoint ou flag que distinga claramente suporte vs médico na métrica de FILA DE ESPERA.
4. **Transição pós-approve** — definir quando `approved` deve ir para RECEITAS PRONTAS vs permanecer em EM ATENDIMENTO.
5. **Script reject** — usar `FORA_DO_PROTOCOLO` ou outro código válido em automações.
6. **Validar Evolution** — confirmar instância conectada e webhook n8n staging ativo.

---

**Artefatos:**
- `docs/FASE-INTEGRACAO-PAINEL-RELATORIO.json`
- `docs/HOMOLOGACAO-5-PACIENTES-FILA-11-15-RELATORIO.json`
- Scripts: `mdoctor-backend/scripts/fase-integracao-painel-audit.js`, `homologacao-5-pacientes-fila-11-15.js`

**Nenhuma alteração visual/CSS/layout foi feita.**
