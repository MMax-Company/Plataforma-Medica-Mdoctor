# STATUS-AGENTES — Continuidade Cursor ↔ Claude

Documento único de handoff entre agentes. **Consultar antes de iniciar qualquer tarefa** e **atualizar ao concluir** (nova entrada no topo do histórico).

## Regras

1. Ler este arquivo + `CLAUDE.md` antes de codar ou operar infra.
2. Staging por padrão; produção (`thbwoogytwcidxrrboym`, `Painel Medico`, `web`) só com solicitação explícita.
3. Não fazer `git push origin main` salvo ordem explícita (dispara auto-deploy do painel produção).
4. Um registro por tarefa concluída (commits relacionados podem ser citados juntos).
5. Manter entradas objetivas; não duplicar documentação técnica longa aqui.

## Ambientes de referência (staging)

| Recurso | Identificador |
|---------|----------------|
| Backend | `mdoctor-backend-staging` → `https://mdoctor-backend-staging-staging.up.railway.app` |
| Painel | `painel-medico-staging` |
| Supabase | `usihurogvphtjedyhyfl` |
| Typebot | self-hosted `doctor-prescreve-8rmljgu` |
| Paciente teste | +55 11 98548-5777 |
| Meta teste | +1 555-636-6961 |
| Atendimento ref. | `a8704590-c474-4b7b-b9f3-02b7de28c257` |

## Template (copiar para cada nova entrada)

```markdown
### YYYY-MM-DD — [Título curto da tarefa]

| Campo | Valor |
|-------|--------|
| **Data** | YYYY-MM-DD HH:MM (BRT) |
| **Agente** | Cursor / Claude / outro |
| **Tarefa** | … |
| **Causa** | … |
| **Correção** | … |
| **Arquivos alterados** | … |
| **Commit(s)** | `hash` — mensagem |
| **Deploy** | serviço / deployment-id / status — ou *nenhum* |
| **Ambiente alterado** | staging backend / staging panel / Supabase staging / nenhum |
| **Testes** | comando + resultado |
| **Pendências** | … ou *nenhuma* |
| **Produção alterada** | **Não** / **Sim** |
```

---

## Histórico recente

### 2026-07-18 — Upload de receita sem resposta no WhatsApp (staging)

| Campo | Valor |
|-------|--------|
| **Data** | 2026-07-18 ~02:15 (BRT) |
| **Agente** | Claude |
| **Tarefa** | Após o paciente 98548 enviar a receita, sem resposta no WhatsApp e atendimento fora do painel médico. |
| **Causa** | (1) Rate limit de `/api/whatsapp/webhook` era 20 req/min por IP; as rajadas de status da Meta (sent/delivered/read) estouraram o limite e o webhook com a foto do paciente levou **429** e foi descartado (8 audit logs `webhook_rate_limited` 04:13:45–56Z; atendimento `8b4809ee` preso em `awaiting_prescription_upload` sem arquivo). (2) Latente no Typebot self-hosted: os 6 `responseVariableMapping` dos blocos `axuwb907imxr22bqbnugj3ab` (triagem) e `blk_upload_status_webhook` usavam `bodyPath` sem prefixo `data.` — o engine 3.17.2 avalia `Function('statusCode','data', 'return (expr)')`, então `upload_status_url`/`upload_completed`/`atendimentoId` ficavam sempre `undefined` e a conferência pós-upload caía no ramo "upload pendente" (pedia nova foto mesmo com arquivo salvo). Confirmado na sessão real `yc1igfpawthpfe4628au4e49` e no bundle do viewer. |
| **Correção** | (1) `server.js`: limiter próprio do webhook Meta — `WHATSAPP_WEBHOOK_RATE_LIMIT_MAX` (default 300/min) / `WHATSAPP_WEBHOOK_RATE_LIMIT_WINDOW_MS`. (2) Patch direto no Postgres do Typebot (`Typebot` + `PublicTypebot`, typebot `higij2z0xihxxkr378rmljgu`): prefixo `data.` nos 6 bodyPaths de cada tabela; backup pré-patch em `/tmp/tb-groups-backup-20260718.json` no container do builder. Espelhado em `docs/typebot/typebot-doctor-prescreve-homologado-20260716.json` (alterado, **ainda não commitado** por ordem do Max). |
| **Arquivos alterados** | `mdoctor-backend/server.js` (commitado); `docs/typebot/typebot-doctor-prescreve-homologado-20260716.json` (working tree); DB Typebot self-hosted |
| **Commit(s)** | `58e4ef3` — `fix(whatsapp): rate limit proprio para webhook Meta (300/min)` |
| **Deploy** | `mdoctor-backend-staging` → `c2835ef2-fe5e-408f-a01e-1109941de751` — **SUCCESS** (04:28Z) |
| **Ambiente alterado** | staging backend; DB do Typebot self-hosted (Typebot-MDoctor); Supabase staging (atendimento 8b4809ee concluído em teste; sessões WhatsApp 98548 zeradas ao final) |
| **Testes** | Upload real com o token pendente de `8b4809ee`: `POST /api/upload-receita/:token` → status `waiting`, `upload_completed: true`, `storage_path` salvo (`receita-anterior-1784349056932.png`, qualidade `adequate`), `prescription_upload_resume.completed_at` 04:31:00Z, mensagens entregues no WhatsApp (status callbacks Meta) e atendimento visível em `/api/atendimentos/queue`. E2E completo via webhook simulado avançou até o pagamento e foi **interrompido a pedido** — os mapeamentos corrigidos não chegaram a ser exercitados num fluxo novo de ponta a ponta. |
| **Pendências** | Validar e2e o ramo pós-upload com sessão nova (mapeamentos `data.`); commitar o JSON homologado espelhado; script de pagamento via API precisa de `return_url` no confirm do PaymentIntent (só afeta teste, não o fluxo real). |
| **Produção alterada** | **Não** |

---

### 2026-07-17 — Teste E2E pesquisa WhatsApp via webhook Meta

| Campo | Valor |
|-------|--------|
| **Data** | 2026-07-17 ~16:42 BRT |
| **Agente** | Cursor |
| **Tarefa** | Ajustar script E2E da pesquisa pós-entrega para usar `/api/whatsapp/webhook` (Meta) em Q2, Q3 e recusa — alinhado ao fluxo real do paciente 98548. |
| **Causa** | Respostas Q2/Q3 usavam `/api/patient-outcomes/survey/inbound` (n8n) sem secret → `Webhook não autorizado`; falso negativo nos testes. |
| **Correção** | Substituir `surveyInbound()` por `sendWa()` nas respostas após opt-in. |
| **Arquivos alterados** | `mdoctor-backend/scripts/test-whatsapp-survey-staging-98548.js` |
| **Commit(s)** | `78af17a` — `test(whatsapp): pesquisa staging via webhook Meta nas respostas Q2-Q3` |
| **Deploy** | *nenhum* |
| **Ambiente alterado** | nenhum (somente commit local) |
| **Testes** | `node scripts/test-whatsapp-survey-staging-98548.js` — pesquisa completa, skip e decline OK; `full_trigger` ainda 500 local (falta `INGRESS_SERVICE_SECRET`) |
| **Pendências** | Push `main` pendente (8+ commits locais); opcional: secret no script para `survey/trigger` |
| **Produção alterada** | **Não** |

---

### 2026-07-17 — Pesquisa pós-entrega: limpar Typebot a cada step

| Campo | Valor |
|-------|--------|
| **Data** | 2026-07-17 ~16:29 BRT |
| **Agente** | Cursor |
| **Tarefa** | Garantir que cada transição da pesquisa (`opt_in` → Q1 → Q2 → Q3) zere sessão Typebot residual. |
| **Causa** | `typebot_session_id` / contexto de upload permaneciam entre steps da pesquisa. |
| **Correção** | `setSurveySession()` limpa Typebot em toda transição; `sendOutbound: false` no Meta webhook. |
| **Arquivos alterados** | `post-delivery-survey.service.js`, `test-whatsapp-survey-staging-98548.js` |
| **Commit(s)** | `1bfdb98` — `fix(whatsapp): clear typebot on every survey step transition` |
| **Deploy** | `mdoctor-backend-staging` → `211664d4-2968-463f-a9a0-a661c9b0da43` — **SUCCESS** (inclui `976a0c3`) |
| **Ambiente alterado** | staging backend |
| **Testes** | E2E pesquisa staging (ver entrada `78af17a`) |
| **Pendências** | — |
| **Produção alterada** | **Não** |

---

### 2026-07-17 — Pesquisa pós-entrega sem reiniciar triagem

| Campo | Valor |
|-------|--------|
| **Data** | 2026-07-17 ~16:22 BRT |
| **Agente** | Cursor |
| **Tarefa** | Pesquisa opcional após entrega da receita (Q1/Q2/Q3); ao aceitar, não voltar ao upload nem reiniciar Typebot. |
| **Causa** | Sessão Typebot ativa; resposta `"1"` (opt-in pesquisa) roteada como menu/atendimento → triagem ou upload. |
| **Correção** | Prioridade `post_delivery_survey` em `resolveMetaInboundRouting`; bridge Meta bloqueia Typebot; persistência em `patient_outcomes` (`q1_access_alternative`, `q2_avoided_interruption`, `q3_would_use_again`). |
| **Arquivos alterados** | `post-delivery-survey.service.js`, `whatsapp-support.service.js`, `typebot-whatsapp.bridge.js`, `test-whatsapp-survey-staging-98548.js` |
| **Commit(s)** | `976a0c3` — `fix(whatsapp): keep post-delivery survey from restarting typebot triage` |
| **Deploy** | `mdoctor-backend-staging` → `738bb42e` (intermediário) + `211664d4` — **SUCCESS** |
| **Ambiente alterado** | staging backend; Supabase staging (`patient_outcomes` para A8704590 em testes) |
| **Testes** | Opt-in `"1"` → step `q1`, `typebot_session_id: null`; skip `ENCERRAR`; persistência q1=ubs, q2=sim, q3=sim (fluxo completo) |
| **Pendências** | Ver commit `78af17a` para correção do script E2E |
| **Produção alterada** | **Não** |

---

### 2026-07-17 — Menu inicial WhatsApp (Oi → 1/2)

| Campo | Valor |
|-------|--------|
| **Data** | 2026-07-17 ~16:11 BRT |
| **Agente** | Cursor |
| **Tarefa** | Menu `"Oi"`: **1** Iniciar atendimento (Typebot limpo) / **2** Suporte; sem auto-start do chatbot. |
| **Causa** | Webhook Meta (`handleTypebotWhatsAppInbound`) enviava tudo direto ao Typebot `startChat`, ignorando menu em `whatsapp-support.service.js`. |
| **Correção** | `resolveMetaInboundRouting` no bridge; `clearTypebotSession()`; opção 1 limpa sessão; opção 2 fila suporte. |
| **Arquivos alterados** | `typebot-whatsapp.bridge.js`, `whatsapp-support.service.js`, `whatsapp-sessions.store.js`, testes bridge + `test-whatsapp-menu-staging-98548.js` |
| **Commit(s)** | `d29498c` — `fix(backend): menu WhatsApp inicial antes do Typebot no Meta webhook` |
| **Deploy** | `mdoctor-backend-staging` → `7b586a4c-0eb5-4680-84f6-5b366a3c2908` — **SUCCESS** |
| **Ambiente alterado** | staging backend |
| **Testes** | `test-whatsapp-typebot-bridge.js` OK; E2E menu: Oi, opt 1, opt 2, inválida |
| **Pendências** | Tentativa acidental deploy `web` → `f9609606` **FAILED** (prod não afetada) |
| **Produção alterada** | **Não** |

---

### 2026-07-17 — Payload Memed staging (quantidade 60 dias)

| Campo | Valor |
|-------|--------|
| **Data** | 2026-07-17 ~16:01 BRT |
| **Agente** | Cursor |
| **Tarefa** | Payload Memed idêntico ao Supabase: dose/freq/via, qty = doses/dia × 60, unidade `comprimidos`, endereço estruturado. |
| **Causa** | Payload só no painel com qty 30, unit `embalagens` (default Memed), sem endpoint backend canônico. |
| **Correção** | `memed-payload.service.js` + `GET /api/memed/payload/:atendimentoId` (preview, sem emitir). |
| **Arquivos alterados** | `memed-payload.service.js`, `memed.routes.js`, `test-memed-payload-staging.js` |
| **Commit(s)** | `ba34523` — `fix(backend): payload Memed staging com quantidade e endereco estruturado` |
| **Deploy** | `mdoctor-backend-staging` → `60504f8a-e1e1-4e23-853c-81fa7a1a8bda` — **SUCCESS** |
| **Ambiente alterado** | staging backend |
| **Testes** | `test-memed-payload-staging.js` 21/21; API A8704590 → Captopril 25 mg, 2x/dia, **120 comprimidos** |
| **Pendências** | Painel ainda monta payload localmente (integração futura opcional) |
| **Produção alterada** | **Não** |

---

### 2026-07-17 — Dados clínicos triagem staging

| Campo | Valor |
|-------|--------|
| **Data** | 2026-07-17 ~15:53 BRT |
| **Agente** | Cursor |
| **Tarefa** | Validar/persistir medicamento, dose, freq, via; bloquear `__probe__`; endereço estruturado; repetir pergunta inválida. |
| **Causa** | Normalizer aceitava 3 slots Typebot, `__probe__` como dose, `medication_count` declarado vs real, endereço só string. |
| **Correção** | `typebot-clinical-data.validation.js`, sanitização no normalizer, validação unificada no bridge WhatsApp. |
| **Arquivos alterados** | `typebot-clinical-data.validation.js`, `typebot-validation.utils.js`, `clinical-payload-normalizer.service.js`, `typebot-personal-data.validation.js`, `typebot-whatsapp.bridge.js`, `test-clinical-data-validation-staging.js` |
| **Commit(s)** | `6b6dce1` — `fix(backend): validar e persistir dados clinicos da triagem no staging.` |
| **Deploy** | `mdoctor-backend-staging` → `7819afb2-a29d-4d3e-9c01-cceb67fb66a0` — **SUCCESS** |
| **Ambiente alterado** | staging backend; Supabase staging (patch `clinical_data` A8704590: Captopril 25 mg, endereço estruturado) |
| **Testes** | `test-clinical-data-validation-staging.js` 26/26; normalizer + bridge OK |
| **Pendências** | Commits anteriores de painel (`0c03870`, `176f86c`) ainda só locais |
| **Produção alterada** | **Não** |

---

## Estado do repositório (última atualização deste doc)

- **Branch:** `main` — **ahead ~12 commits** vs `origin/main` (sem push)
- **Produção backend (`web`):** deploy ativo `6e0bd595` (2026-06-20)
- **Produção painel:** deploy `1bf9432d` — não redeployado pelos commits acima
- **Staging backend ativo:** `c2835ef2` (rate limit webhook Meta, inclui 58e4ef3)
- **Working tree:** `docs/typebot/typebot-doctor-prescreve-homologado-20260716.json` alterado sem commit (prefixo `data.`)

## Commits locais não listados acima (contexto)

| Commit | Escopo |
|--------|--------|
| `0c03870` | painel — tempo espera fila médica |
| `176f86c` | painel — A8704590 `medical_queue_entered_at` only |

Deploy painel staging desses commits: `5d4e9a2e` / `d6a87281` (anteriores à lista solicitada).
