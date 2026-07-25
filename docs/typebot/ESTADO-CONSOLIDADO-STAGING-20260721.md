# Doctor Prescreve — Estado consolidado do staging (2026-07-21)

**Antes de qualquer nova correção no WhatsApp ou no Typebot, consultar este documento e verificar se a alteração já foi implementada.**

Este documento consolida tudo que foi corrigido e validado em 2026-07-21, entre o teste humano real do número `+55 11 99169-0401` e a validação técnica pré-próximo-teste. Cobre Backend (staging), Typebot oficial (`higij2z0xihxxkr378rmljgu` / `doctor-prescreve-8rmljgu`) e leitura do painel médico. Não substitui os registros individuais por pedido (linkados abaixo); é o ponto único de consulta rápida.

**Estado atual: VALIDADO PARA TESTE HUMANO.** (ver `ROTEIRO-TESTE-HUMANO-20260721.md` para o roteiro/checklist do próximo teste)

---

## 1. Correções de Backend (commits + deploy)

### 1.1 Endereço "Cidade UF" sem vírgula + aviso de upload sem sessão pendente

| Campo | Valor |
|---|---|
| Commit | `b8dfc4f` — `fix(whatsapp): aceita endereço Cidade+UF sem vírgula e avisa paciente sem upload pendente` |
| Arquivos | `mdoctor-backend/src/services/typebot-clinical-data.validation.js`, `mdoctor-backend/src/routes/whatsapp.routes.js` |
| Deploy | staging, validado ao vivo durante o próprio teste humano (id de deployment não capturado à parte; comportamento confirmado em produção pelo reenvio do paciente) |
| Causa raiz 1 | `parseBrazilianAddress` só reconhecia endereço em 5 partes separadas por vírgula ou fallback de cidade composta acentuada. Endereço real do paciente ("Rua Aurora, 965, Santa Efigenia, Sao Paulo SP") tem 4 partes, com cidade+UF grudados sem vírgula → loop infinito de revalidação. |
| Correção 1 | Quando há exatamente 4 partes, detecta sufixo `<Cidade> <UF>` (regex `/^(.+?)\s+([A-Za-z]{2})$/` com UF validada contra `BRAZILIAN_STATES`) na última parte e a divide em duas, reaproveitando a lógica já existente do caminho de 5 partes. |
| Causa raiz 2 | Quando a triagem já havia reprovado o atendimento antes do paciente enviar a foto da receita, `findPendingUploadContext` corretamente recusava o vínculo — mas não respondia nada no WhatsApp (falha silenciosa). |
| Correção 2 | Envia mensagem explicativa ("Não localizamos uma solicitação aguardando o envio de documentos...") quando não há contexto de upload pendente, em vez de descartar silenciosamente. |
| Testes | Reprodução local de `validateStructuredAddress` com a frase real do paciente antes/depois; comportamento confirmado ao vivo (retry do paciente recebeu a explicação). |
| Registro Typebot correlato | `docs/typebot/CORRECAO-ENDERECO-20260721.md` (ajuste de texto/placeholder do bloco de endereço, publicado em paralelo) |

### 1.2 Sincronização do pagamento Stripe confirmado com o atendimento

| Campo | Valor |
|---|---|
| Commit | `7d90243` — `fix(triagem): sincroniza payment_status confirmado (Stripe) com o atendimento criado na triagem` |
| Arquivos | `mdoctor-backend/src/services/triagem-webhook.service.js`; novo `mdoctor-backend/scripts/test-triagem-payment-sync.js` |
| Deploy | staging `484e9b63` — SUCCESS |
| Causa raiz | `processTriagemWebhook` derivava `pagamento_status`/`payment_confirmed` só dos campos do próprio payload da triagem (n8n), nunca consultando `whatsapp_sessions.metadata.typebot_payment` — a fonte já confirmada pelo Stripe Checkout (Fase 2 Pedido 2). |
| Correção | Nova função `resolveConfirmedPaymentFromSession(phone)` busca a sessão do mesmo telefone; se `status==='completed'` ou `payment_status==='paid'`, sobrescreve `pagamento_status='CONFIRMADO'`, `payment_status='paid'`, `payment_confirmed=true` e grava metadados Stripe (`stripe_checkout_session_id`, `stripe_paid_at`, `stripe_event_id`, `stripe_amount_cents`, `stripe_amount_label`, `stripe_currency`, `payment_sync_source`) em `dados_clinicos`. Removida também uma sobrescrita redundante no `createAtendimento(...)` que anulava o próprio fix. |
| Testes | `node scripts/test-triagem-payment-sync.js` — **5/5 ok** (sem sessão confirmada mantém pendente; sessão confirmada sincroniza; atendimento nasce com status correto; evento repetido não duplica/regride; outro paciente não é afetado). Reexecutado em 2026-07-21 durante a validação final — continua 5/5. |
| Reparo manual autorizado | Atendimento `95ecafa9-a99f-42b6-aa91-6c8a93b73a31` (criado no teste humano, antes do fix) teve `payment_status` corrigido manualmente para `CONFIRMADO` **depois** de confirmar `status==='rejected'` (elegibilidade/status não tocados). Registrado em `clinical_data.payment_sync_source = "manual_repair_20260721"`. |

### 1.3 Upload da receita anterior via WhatsApp — retomada automática + vínculo de mídia

| Campo | Valor |
|---|---|
| Commit | `4e0b623` — `fix(prescription-upload): retoma o Typebot automaticamente após receita anterior via WhatsApp` |
| Arquivos | `mdoctor-backend/src/services/typebot-prescription-upload.service.js`, `mdoctor-backend/src/services/prescription-upload.service.js`, `mdoctor-backend/scripts/test-typebot-prescription-upload.js` (11 → 18 checks) |
| Deploy | staging `63ba32f2` — **SUCCESS, ativo no momento desta consolidação** |
| Causa raiz | `resumeTypebotAfterPrescriptionUpload` existia e funcionava, mas só era chamada pela rota legada da página externa de upload (`upload-receita.routes.js`). `ingestWhatsAppPrescriptionMedia` (recebimento direto da foto no WhatsApp) nunca a chamava — paciente ficava esperando um clique manual que não existia mais no fluxo ("Conferir novamente" / "Já enviei" foram removidos em pedido anterior). |
| Correção | `ingestWhatsAppPrescriptionMedia` chama `resumeTypebot(...)` automaticamente ao final (best-effort, try/catch isolado, não derruba a ingestão em caso de falha). `mediaId`/`messageId` do WhatsApp agora são passados até `completeExternalPrescriptionUpload`, que os grava em `clinical_data.prescription_ingest.whatsapp_media_id` / `.whatsapp_message_id` — vínculo rastreável entre a mídia do WhatsApp e o atendimento certo. |
| Bloqueio correto preservado | Atendimento já reprovado (`status='rejected'`) continua **recusando** vincular mídia — por desenho, não é bug. É esse caminho que dispara o aviso do item 1.1 (correção 2). |
| Testes | `node scripts/test-typebot-prescription-upload.js` — **18/18 ok**, incluindo os novos checks `avancaAutomaticamenteSemClique`, `mediaIdEMessageIdRegistrados`, `falhaNaRetomadaNaoDerrubaIngestao`, `atendimentoReprovadoNaoAceitaMidia`, validação de formato/tamanho de arquivo. Reexecutado em 2026-07-21 — continua 18/18. |
| Ressalva não bloqueante | **Nenhum atendimento real no banco ainda percorreu este caminho específico depois do deploy `63ba32f2`.** A cobertura de hoje é só por teste automatizado — o próximo teste humano será a primeira execução real em produção/staging pós-deploy. |

---

## 2. Correções só no Typebot (Builder API, sem commit de código)

Todas publicadas e reverificadas independentemente (nova leitura do Typebot **publicado**, não só do rascunho) em 2026-07-21. Backups completos antes/depois de cada uma em `backups/typebot-doctor-prescreve-{antes,depois}-20260721-*.json`.

| # | Item | Registro detalhado | Blocos/variáveis tocados |
|---|---|---|---|
| 1 | Placeholder/pergunta de endereço | `CORRECAO-ENDERECO-20260721.md` | `blk_pergunta_endereco`, `q78qjnk6ticwkeifl7xe2rju` |
| 2 | Correções textuais (botão inicial, condição clínica, telemedicina, elegibilidade, "consulta médica") | `CORRECOES-TEXTUAIS-20260721.md` | `sbjZWLJGVkHAkDqS4JQeGow`, `hda2dcvh33856qga899drcfi`, `blk_tele_intro`, `iw6zqwf26frmqnp1csxiwlbm`, `blk_gate_txt` |
| 3 | Resumo clínico (condição/medicamentos apareciam vazios) | `CORRECAO-RESUMO-CLINICO-20260721.md` | `blk_resumo_set_condicoes`, `blk_resumo_set_medicamentos` |
| 4 | 5 links jurídicos padronizados (clicáveis, sem URL bruta) | `CORRECAO-LINKS-JURIDICOS-20260721.md` | `blk_lgpd_docs` (já correto), `blk_tele_docs`, `blk_terms_doc` |
| 5 | Intervalo de frequência (3 blocos) + CPF mascarado no resumo | `CORRECAO-FREQ-INTERVALO-E-CPF-20260721.md` | `blk_med1/2/3_freq_intervalo`; **novo** `blk_resumo_set_cpf_mascarado` + **nova** variável `var_resumo_cpf_mascarado` |

**Causa raiz recorrente (itens 3 e 5):** dentro de blocos "Set variable" com código customizado, `{{variável}}` escrito **entre aspas** no `expressionToEvaluate` é avaliado como JavaScript real (não template string) — o Typebot substitui a variável por um token JS já válido; colocar aspas manualmente quebra o valor. Confirmado via documentação oficial (`docs.typebot.io/editor/blocks/logic/set-variable`). Encontrado e corrigido em 5 blocos ao todo hoje.

### Verificação direta no Typebot **publicado** (não só no rascunho)

Reconfirmado por leitura fresca de `GET /publishedTypebot` em 2026-07-21 (`updatedAt: 2026-07-21T10:50:37.637Z`, bate com o último publish):

- `resumoCondicoesSemAspas` / `resumoMedicamentosSemAspas`: **true**
- `blocoCpfMascaradoPresente`: **true**; resumo usa `{{resumo_cpf_mascarado}}` (não mais `{{cpf_paciente}}`)
- `freq1/2/3SemAspas`: **true**
- 5/5 links jurídicos como âncora clicável, nenhuma URL bruta em texto visível

---

## 3. Decisões que devem ser preservadas (não refazer, não reverter)

- **CPF mascarado é só na experiência do paciente.** O texto do resumo no WhatsApp usa `{{resumo_cpf_mascarado}}` (formato `123.***.***-09`). A variável original `cpf_paciente` **nunca foi tocada** e continua com o valor completo.
- **CPF original é preservado no Backend, no painel, no Memed e no prontuário.** `patient_cpf` no banco nunca é mascarado; `ProntuarioOperacionalModal.tsx` (view principal do médico) exibe o CPF completo formatado (`123.456.789-01`). Não existe nenhuma máscara de CPF fora do texto do WhatsApp.
- **Ordem da pergunta de receita anterior está correta e não deve mudar:** bloco `blk_receita_choice` (grupo `grp_receita_anterior`) — botões na ordem **"Sim, possuo" / "Não possuo" / "Enviar depois"**. Confirmado no Typebot publicado em 2026-07-21, inalterado por qualquer pedido de hoje.
- **5 documentos jurídicos, mesmas URLs, mesma distribuição por grupo** (LGPD com 2 docs, Telemedicina com 2 docs, Termos com 1 doc) — só a apresentação (texto simples + URL bruta → `📄 ` + nome clicável) mudou.
- **Bloqueio de vínculo de mídia em atendimento reprovado é comportamento correto, não bug.** Quando `findPendingUploadContext` retorna null porque o atendimento já foi reprovado, a mídia não deve ser vinculada — isso está certo. O que foi corrigido foi só a ausência de resposta ao paciente nesse caso (item 1.1).

## 4. Itens que não devem ser refeitos

- Parser de endereço "Cidade UF" sem vírgula (`b8dfc4f`).
- As 5 correções textuais do Typebot (botão, condição, telemedicina, elegibilidade, "consulta médica").
- Expressões do resumo clínico (condições/medicamentos) sem aspas.
- Formatação dos 5 links jurídicos.
- Expressões de intervalo de frequência (3 blocos) sem aspas + guarda contra `undefined`.
- Mascaramento de CPF no resumo do Typebot.
- Sincronização de `payment_status` via `whatsapp_sessions` (`7d90243`).
- Retomada automática do Typebot após upload de mídia via WhatsApp + registro de `whatsapp_media_id`/`whatsapp_message_id` (`4e0b623`).
- Mensagem explicativa quando não há upload pendente (`b8dfc4f`).

## 5. Ressalvas não bloqueantes (conhecidas, não impedem o teste humano)

1. **Retomada automática pós-upload** (`4e0b623`) só tem cobertura por teste automatizado (18/18) — nenhum atendimento real no banco a exercitou desde o deploy. O próximo teste humano será a primeira validação em produção real.
2. **Intervalo de frequência não chega ao painel.** O valor calculado pelos blocos `blk_med1/2/3_freq_intervalo` ("a cada 12 horas" etc.) é uma variável interna do Typebot — não é enviado no payload da triagem para o n8n/Backend, não é persistido em `clinical_data` e não aparece hoje em lugar nenhum visível ao médico. Corrigida a causa raiz da expressão em si (não gerava mais "undefined"), mas o campo permanece sem consumidor downstream. **Decisão explícita: não corrigir agora** — fora do escopo deste pedido.

## 6. Validação final do painel médico (2026-07-21, dados existentes, sem novo teste humano)

| Item | Resultado | Evidência |
|---|---|---|
| Pagamento confirmado | ok | `95ecafa9` e `5cdc43ec`: `payment_status="CONFIRMADO"` |
| Receita anterior vinculada e visível | ok, com ressalva | `5cdc43ec` (registro de 17/07, anterior ao deploy de hoje) tem `prescription_ingest.storage_path` e `status="waiting"`. Nenhum atendimento pós-deploy de hoje ainda tem receita vinculada — consistente com a ressalva da seção 5.1 |
| Condição clínica preenchida | ok | `condition="has"` |
| Medicamentos (dose/frequência/via) | ok | Presentes em `clinical_data.medications[]` |
| Medicamentos (intervalo) | não aplicável hoje | Ver ressalva 5.2 — campo não chega ao painel |
| CPF original preservado no painel | ok | `patient_cpf` sem máscara no banco e no prontuário |
| Status correto do atendimento | ok | `rejected` para triagem reprovada; `waiting` para fila médica |
| Entrada correta na fila médica | ok | `waiting` é o status canônico de fila (`atendimentos.store.js`: `QUEUE`/`FILA` = `'waiting'`) |
| Ausência de duplicidade | ok | Nenhum outro atendimento para `+5511991690401` |
| Ausência de vínculo com outro paciente | ok | `5cdc43ec.patient_id = null` — sem `patient_id` compartilhado |

## 7. Backups gerados hoje

```
backups/typebot-doctor-prescreve-antes-livefix-20260721-endereco.json
backups/typebot-doctor-prescreve-depois-livefix-20260721-endereco.json
backups/typebot-doctor-prescreve-antes-20260721-textual.json
backups/typebot-doctor-prescreve-depois-20260721-textual.json
backups/typebot-doctor-prescreve-antes-20260721-resumo.json
backups/typebot-doctor-prescreve-depois-20260721-resumo.json
backups/typebot-doctor-prescreve-antes-20260721-doclinks.json
backups/typebot-doctor-prescreve-depois-20260721-doclinks.json
backups/typebot-doctor-prescreve-antes-20260721-freq-cpf.json
backups/typebot-doctor-prescreve-depois-20260721-freq-cpf.json
```

## 8. Testes executados nesta consolidação (2026-07-21)

- `node scripts/test-triagem-payment-sync.js` → 5/5 ok
- `node scripts/test-typebot-prescription-upload.js` → 18/18 ok
- Leitura direta do Typebot **publicado** (`GET /publishedTypebot`) confirmando todos os itens da seção 2
- `railway status` → staging Online; `curl /health` → 200
- Log real confirmando webhook Meta ativo: `POST /api/whatsapp/webhook`, `userAgent="facebookexternalua"`, `status=200`, 2026-07-21 10:12
- Consultas somente-leitura ao Postgres (Supabase) para `whatsapp_sessions` e `appointments` — ver seção 6

---

## Estado atual

**VALIDADO PARA TESTE HUMANO.** Nenhum bloqueio real pendente. Ver `docs/typebot/ROTEIRO-TESTE-HUMANO-20260721.md` para preparação do próximo teste (sessão do número de teste, roteiro, checklist).
