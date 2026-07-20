# Fluxo oficial — perguntas e respostas (WhatsApp + Typebot + n8n)

**Fonte canônica deste fluxo.**  
**Atualizado:** 2026-07-20  
**Escopo:** staging oficial Meta Cloud API + Typebot `doctor-prescreve-8rmljgu` (`higij2z0xihxxkr378rmljgu`) + n8n staging + backend PRs #27–#30.

**Fontes usadas (somente implementado):**

| Fonte | Caminho / referência |
|-------|----------------------|
| Status agentes | `docs/STATUS-AGENTES.md` |
| JSON Typebot no repo | `docs/typebot/typebot-doctor-prescreve-staging-safe.json` |
| Bridge Meta↔Typebot | `mdoctor-backend/src/services/typebot-whatsapp.bridge.js` |
| Menu Meta | `mdoctor-backend/src/services/whatsapp-meta-inbound.service.js` |
| Pagamento | `mdoctor-backend/src/services/typebot-payment*.js` |
| Upload | `mdoctor-backend/src/services/typebot-prescription-upload.service.js` |
| Validação dados | `mdoctor-backend/src/services/typebot-personal-data.validation.js` |
| Triagem / rejeição / entrega | `triagem-webhook.service.js`, `clinical-decision.service.js`, `delivery.service.js` |
| n8n ativos | `docs/n8n-workflows/typebot-webhook-staging.json`, `clinical-rejection-notify-staging.json`, `prescription-delivery-staging.json` |

**Convenções**

- **Controladores:** Backend · Typebot · n8n · Stripe · Meta.
- **DIVERGENTE:** diferença comprovada entre documento / JSON / backend / n8n / STATUS.
- **PENDENTE DE DEFINIÇÃO:** não comprovado no código ou JSON analisados.
- Ordem abaixo é a **ordem real do happy path** no JSON + backend (não a ordem mental “medicamentos antes do pagamento”).

---

## Diagrama resumido (happy path)

```
Meta webhook
  → Backend menu 1/2
  → [1] Typebot startChat
      Bem-vindo → LGPD → Nome social → Doença → Tempo → Sinais → Telemedicina
      → Elegibilidade → Dados (nome…CEP…endereço) → Receita anterior → Termos
      → Pagamento (Stripe via Backend) → Qtd meds → Med(s) → Confirmação
      → Webhook n8n typebot-webhook → Backend /api/webhook/triagem (cria atendimento)
      → Upload receita (Meta mídia / Backend resume) → mensagem fila
  → Painel médico
      → Reprovação (Backend outbox)  |  Entrega (n8n→/deliver ou Backend)
  → [2] Suporte (Backend, sem Typebot)
```

---

## Tabela mestre de etapas

Colunas: `ordem | origem | bloco/input | pergunta exata | tipo | opções | valor enviado | variável | próxima | inválido | controla`

### E01 — Menu inicial 1/2

| Campo | Conteúdo |
|-------|----------|
| ordem | 1 |
| origem da mensagem | Backend (Meta inbound) |
| bloco/input | — (não é Typebot) |
| pergunta exata | `1 - Iniciar atendimento` / `2 - Suporte` |
| tipo de resposta | texto numérico |
| opções exibidas | `1`, `2` (também dispara menu: `Oi`/`Olá`/`OLA`/`MENU`/`0`/`ENCERRAR`) |
| valor enviado | `1` ou `2` (texto livre reexibe menu) |
| variável salva | — |
| próxima etapa | `1` → E02 (Typebot); `2` → E24 (Suporte) |
| comportamento se inválido | Reenvia o menu |
| controla | **Backend** + **Meta** |
| notas | Com sessão Typebot **ativa** (`typebot_session_id` + `typebot_expected_input_id`), `1`/`2` vão para Typebot (PR #29), não reiniciam menu. |

### E02 — Bem-vindo

| Campo | Conteúdo |
|-------|----------|
| ordem | 2 |
| origem | Typebot grupo `Bem-Vindo` (`kinRXxYop2X4d7F9qt8WNB`) |
| bloco/input | choice `sbjZWLJGVkHAkDqS4JQeGow` |
| pergunta exata | Texto: `Olá 👋 Este é o assistente do Doctor Prescreve. Aqui você pode solicitar avaliação médica para renovação de receita de forma segura e legal.` + `Este atendimento não substitui consulta médica presencial em casos de urgência.` |
| tipo | choice (única) |
| opções | `Iniciar Atendimento` (item `hQw2zbp7FDX7XYK9cFpbgC`) |
| valor enviado | conteúdo da opção (sem `value` no JSON) |
| variável | — |
| próxima | E03 LGPD |
| inválido | Typebot: “Invalid message…” / Backend lista: `Escolha uma opção:` |
| controla | **Typebot** · entrega **Meta** via Backend |

### E03 — LGPD

| Campo | Conteúdo |
|-------|----------|
| ordem | 3 |
| origem | Typebot `Consentimento LGPD` |
| bloco/input | choice `ivbr3o1a7lv8izhfteuerhqx` |
| pergunta exata | `Antes de continuar, leia os documentos abaixo:` + links Consentimento LGPD / Política de Privacidade + `Ao continuar, você autoriza o tratamento dos seus dados pessoais e de saúde para fins de triagem, atendimento, prontuário e emissão de receita digital.` |
| tipo | choice |
| opções | `Autorizo` (`sim`) · `Não autorizo` (`nao`) |
| valor enviado | `sim` / `nao` (Backend envia o `content`/`value` conforme match) |
| variável | `lgpd_accepted` (+ sets `privacy_policy_accepted=true`, `accepted_terms_links` no ramo Autorizo) |
| próxima | Autorizo → E04; Não autorizo → encerramento LGPD (sem fila) |
| inválido | choice inválida |
| controla | **Typebot** |

### E04 — Nome social

| Campo | Conteúdo |
|-------|----------|
| ordem | 4 |
| origem | Typebot `Nome social` |
| bloco/input | text input `oq3zsok0c2tdl3qamma8tush` |
| pergunta exata | `Como você gostaria de ser chamado durante o atendimento?` · placeholder `Exemplo: José Souza.` |
| tipo | texto livre |
| opções | — |
| valor enviado | texto do paciente |
| variável | **PENDENTE DE DEFINIÇÃO** — `variableId` `vou30coxarhyas9y5q07k78k9` **não** está em `variables[]` |
| próxima | E05 |
| inválido | Typebot aceita qualquer texto não vazio (sem validação Backend neste id) |
| controla | **Typebot** |

### E05 — Condições clínicas (doença crônica)

| Campo | Conteúdo |
|-------|----------|
| ordem | 5 |
| origem | Typebot `Doença Cronica` |
| bloco/input | choice múltipla `b156nm008xh7gb52n7w3egzn` · botão `Confirmo` |
| pergunta exata | `Olá, você faz tratamento para:` |
| tipo | múltipla escolha (Backend acumula até `Confirmo`) |
| opções | `Hipertensão Arterial`=`has` · `Diabetes Melitus`=`dm` · `Dislipidemia`=`dlp` · `Hipotireidismo`=`hipotireoidismo` |
| valor enviado | values unidos por vírgula (ex.: `has, dm`) |
| variável | `doenca_cronica` |
| próxima | E06 |
| inválido | `Opção inválida…` / exige ≥1 opção antes de Confirmo |
| controla | **Backend** (multi-choice) + **Typebot** |

### E06 — Tempo de uso

| Campo | Conteúdo |
|-------|----------|
| ordem | 6 |
| origem | Typebot `Tempo de Uso` |
| bloco/input | choice `r0imrcgaiv1idzkykt891q4u` |
| pergunta exata | `Há quanto tempo você usa esse medicamento?{{tempo_uso}}` (**literal** `{{tempo_uso}}` no texto) |
| tipo | choice |
| opções | `Menos de 1 mês` · `1 a 6 meses` · `Mais de 6 meses` (sem `value`) |
| valor enviado | content da opção |
| variável | `tempo_uso` |
| próxima | `<1 mês` → encerramento presencial; demais → E07 |
| inválido | choice inválida |
| controla | **Typebot** |
| nota | `continuous_use_days` aparece no webhook mas **não é setada** no fluxo — **PENDENTE** |

### E07 — Sinais de alerta

| Campo | Conteúdo |
|-------|----------|
| ordem | 7 |
| origem | Typebot `Sinais de Alerta` |
| bloco/input | choice múltipla `s5VQGsVF4hQgziQsXVdwPDW` · `Confirmo` |
| pergunta exata | `Você teve algum destes eventos recentemente?` |
| tipo | múltipla |
| opções | `Dor no peito`=`dor_peito` · `Falta de ar`=`falta_ar` · `Desmaio`=`desmaio` · `Febre alta persistente`=`febre` · `Sangramento`=`sangramento` · `Nenhum destes`=`NAO` |
| valor enviado | values; `NAO` é exclusivo (Backend) |
| variável | `sinais_alerta` |
| próxima | Equal to `NAO` → E08; senão → encerramento “sinal alerta” |
| inválido | multi-choice inválida |
| controla | **Backend** + **Typebot** |
| nota | `has_warning_signs` no webhook **não é setada** — **PENDENTE** |

### E08 — Telemedicina / não urgência

| Campo | Conteúdo |
|-------|----------|
| ordem | 8 |
| origem | Typebot `Telemedicina e não urgência` |
| bloco/input | choice `blk_tele_choice` |
| pergunta exata | `Este atendimento é uma teleconsulta assíncrona…` + links Consentimento Telemedicina / Aviso Não Urgência |
| tipo | choice |
| opções | `Estou ciente e desejo continuar`=`sim` · `Não desejo continuar`=`nao` |
| valor enviado | `sim` / `nao` |
| variável | `telemedicine_consent_accepted` (+ `non_urgency_notice_accepted=true` no aceito) |
| próxima | sim → E09; nao → encerramento telemedicina |
| inválido | choice inválida |
| controla | **Typebot** |

### E09 — Elegibilidade (declaração)

| Campo | Conteúdo |
|-------|----------|
| ordem | 9 |
| origem | Typebot `Declaração de elegibilidade` |
| bloco/input | choice `w9v6g0rlkucnfmxc3qh2a2qt` (**sem** `variableId`) |
| pergunta exata | `📋 CRITÉRIOS DE ELEGIBILIDADE` + bullets (diagnóstico prévio / uso contínuo / receita anterior) + `Você confirma que atende aos critérios acima?` |
| tipo | choice |
| opções | `Sim` value=`{{SIM}}` · `Não` value=`{{NÃO}}` |
| valor enviado | content/`{{SIM}}`/`{{NÃO}}` |
| variável | **nenhuma** ligada ao choice |
| próxima | Sim → texto “Solicitação Elegível” → E10; Não → encerramento |
| inválido | choice inválida |
| controla | **Typebot** |
| nota | Edge pós-elegível `edge_elegivel_to_dados` (PR #30). Values `{{SIM}}`/`{{NÃO}}` são literais — possível **DIVERGENTE** vs match por content. |

### E10 — Dados pessoais (nome, nascimento, CPF, WhatsApp, e-mail)

| Campo | Conteúdo |
|-------|----------|
| ordem | 10 |
| origem | Typebot `Dados Pessoais` |
| bloco/input | intro + 5 inputs |
| pergunta exata | Intro: `Pode nos informar seus dados pessoais?{{dados_pessoais}}` |

Sub-inputs (cada um é uma pergunta ao paciente):

| input id | placeholder / pergunta | variável | validação Backend |
|----------|------------------------|----------|-------------------|
| `ds9z9lnz3yayokyy8d81fudj` | `Qual seu nome completo?` | `Nome_Completo` | ≥2 palavras |
| `ar8jtu7sa8gfndqeebrvyj15` | `Nascimento (dd/mm/aaaa ou 8 dígitos)` | `data_nascimento` | idade 18–80 |
| `dein7u2qnr8q32p2lv1krd5p` | `Qual número do seu CPF?` | `cpf_paciente` | CPF 11 dígitos |
| `tbla9w2i2kbeyzun88hai3s9` | `(11) 99999-9999` | `whatsapp` | telefone BR |
| `dwoaqosurlamebpra9yf7pm4` | `seuemail@exemplo.com` | `Email` | e-mail |

| próxima | E11 CEP |
| inválido | Backend: `{erro}\n\n{pergunta}` **sem** chamar Typebot |
| controla | **Typebot** + **Backend** (validação) |

### E11 — CEP

| Campo | Conteúdo |
|-------|----------|
| ordem | 11 |
| origem | Typebot (mesmo grupo Dados Pessoais) |
| bloco/input | text `blk_0oydu2f7` |
| pergunta exata | placeholder `CEP (somente números)` |
| tipo | texto |
| opções | — |
| valor enviado | dígitos |
| variável | `cep` |
| próxima | E12 |
| inválido | Backend: CEP 8 dígitos |
| controla | **Typebot** + **Backend** |

### E12 — Endereço

| Campo | Conteúdo |
|-------|----------|
| ordem | 12 |
| origem | Typebot |
| bloco/input | text `q78qjnk6ticwkeifl7xe2rju` |
| pergunta exata | placeholder no JSON do repo: `Endereço com CEP` |
| tipo | texto |
| opções | — |
| valor enviado | texto |
| variável | `Endereco` |
| próxima | pretendida: E13 Receita anterior |
| inválido | Backend: endereço ≥10 chars / ≥2 palavras |
| controla | **Typebot** + **Backend** |
| **DIVERGENTE** | `outgoingEdgeId` do bloco = `b0xx8xgpeppttigdubv0bm9a` (**edge inexistente**). Existe `edge_dados_to_receita` com `from.blockId` **truncado** `q78qjnk6ticw`. STATUS-AGENTES afirma “edge do endereço corrigido”; **no JSON desta branch/main o edge ainda está quebrado**. |

### E13 — Receita anterior (pergunta)

| Campo | Conteúdo |
|-------|----------|
| ordem | 13 |
| origem | Typebot `Receita anterior` |
| bloco/input | choice `blk_receita_choice` |
| pergunta exata | `Você possui uma receita médica anterior e a foto dela disponível para envio agora pelo WhatsApp?` |
| tipo | choice |
| opções | `Sim, tenho a receita e a foto`=`sim` · `Não`=`nao` |
| valor enviado | `sim` / `nao` |
| variável | `has_previous_prescription` (+ gate seta `eligibility_status=eligible`, `has_prescription_photo_ready=sim`) |
| próxima | sim → Termos (pré-pagamento) → E16; nao → encerramento presencial |
| inválido | choice inválida |
| controla | **Typebot** |

### E13b — Termos de uso (pré-pagamento)

| Campo | Conteúdo |
|-------|----------|
| ordem | 13b (entre receita e pagamento no JSON) |
| origem | Typebot `Termos de uso` |
| bloco/input | choice `blk_terms_choice` |
| pergunta exata | `Antes de realizar o pagamento, leia e aceite os termos de uso do Doctor Prescreve.` + PDF Política e Termos |
| tipo | choice |
| opções | **somente** `Li e concordo com os termos`=`sim` |
| valor enviado | `sim` |
| variável | `terms_of_use_accepted` (+ timestamps/links/summary) |
| próxima | E16 Pagamento |
| inválido | sem ramo “Não” — **PENDENTE** caminho de recusa |
| controla | **Typebot** |

### E16 — Pagamento (Stripe Checkout via Backend)

| Campo | Conteúdo |
|-------|----------|
| ordem | 16 (no JSON: **antes** dos medicamentos) |
| origem | Typebot `payment input` `rapfykn1f1uno89ypqmwi43f` interceptado pelo Backend |
| bloco/input | `rapfykn1f1uno89ypqmwi43f` |
| pergunta exata (Backend) | `O valor da consulta médica e da análise das informações enviadas é de R$ 69,90.` + `O pagamento corresponde à consulta e não garante a emissão da receita.` + `Após a confirmação do pagamento, o atendimento continuará automaticamente.` + CTA `Pagar R$ 69,90` |
| tipo | pagamento externo (Stripe Checkout) |
| opções (pendente) | `Conferir pagamento` · `Abrir pagamento novamente` · `Cancelar e continuar depois` |
| valor enviado à Typebot na retomada | texto sintético **`Success`** |
| variável | estado em `whatsapp_sessions.metadata.typebot_payment` (não seta `payment_status` no Typebot) |
| próxima | E17 → E14 quantidade de medicamentos |
| inválido / pendente | mensagens Backend: ainda não confirmou / falhou / cancelou |
| controla | **Backend** + **Stripe** + **Meta** (Typebot só emite o payment input) |

### E17 — Retomada após Stripe

| Campo | Conteúdo |
|-------|----------|
| ordem | 17 |
| origem | Stripe webhook `checkout.session.completed` → Backend `completePaymentByToken` |
| bloco/input | continueChat com `Success` no payment input |
| pergunta exata (confirmado) | `Pagamento confirmado.` / `Agora vamos coletar as informações dos medicamentos e concluir o envio da sua receita anterior.` |
| tipo | automático (não é resposta do paciente) |
| opções | — |
| valor enviado | `Success` |
| variável | metadata payment `status=completed` / `flow_resumed` |
| próxima | E14 |
| inválido | idempotência `flow_resumed`; sem double-resume |
| controla | **Stripe** + **Backend** + **Typebot** + **Meta** |

### E14 — Quantidade de medicamentos

| Campo | Conteúdo |
|-------|----------|
| ordem | 14 |
| origem | Typebot |
| bloco/input | choice `w97ho902ina4lg7b6dn0sycw` |
| pergunta exata | `Quantos medicamentos deseja renovar?` |
| tipo | choice |
| opções | `1`=`1` · `2`=`2` · `3`=`3` |
| valor enviado | `1`/`2`/`3` |
| variável | `medication_count` |
| próxima | E15 Medicamento 1 |
| inválido | choice inválida |
| controla | **Typebot** |

### E15 — Medicamento N (nome, dose, frequência, via)

Repete para N=1..`medication_count` (grupos Medicamento 1/2/3).

#### E15.a Nome

| Campo | Conteúdo |
|-------|----------|
| bloco | `blk_xp763m78` / `blk_fjhq98ob` / (med3 equiv.) |
| pergunta | texto `Medicamento N de {{medication_count}} — informe:` + placeholder `Nome do medicamento` |
| variável | `med1_nome` / `med2_nome` / `med3_nome` |
| tipo | texto |
| controla | **Typebot** |

#### E15.b Dose

| Campo | Conteúdo |
|-------|----------|
| placeholder | `Dose (ex.: 50 mg)` |
| variável | `medN_dose` |
| tipo | texto |
| controla | **Typebot** |

#### E15.c Frequência

| Campo | Conteúdo |
|-------|----------|
| opções | `1x ao dia` · `2x ao dia` · `3x ao dia` · `Conforme receita anterior` (sem `value`) |
| variável | `medN_frequencia` |
| tipo | choice |
| controla | **Typebot** |

#### E15.d Via de administração

| Campo | Conteúdo |
|-------|----------|
| bloco med1 | `blk_nggi0xs0` → var `med1_via` · edge `edge_med1_to_route` |
| pergunta | implícita pelo choice (sem text block “via” separado no JSON) |
| opções **no JSON do repo (main)** | `Via oral` · `Outra via` (**sem** `value`) |
| variável | `med1_via` / `med2_via` / `med3_via` |
| próxima | Condition `grp_route_after_medN` |
| controla | **Typebot** |
| **DIVERGENTE (STATUS vs JSON)** | STATUS/teste humano: JSON alterado para Oral/Sublingual/Tópica/Inalatória/Outra; sessão `bqinu71o81n1xvn27uxwfohk` presa; `Oral` não avança. **Neste arquivo do repo (main) as opções ainda são `Via oral` / `Outra via`.** |
| **DIVERGENTE (roteamento)** | Conditions comparam `medication_count` a `"1"` / `"2"` / `"3"` (**com aspas literais** no value), enquanto o choice grava `1`/`2`/`3` — risco de não avançar após a via. |

### E15.e Confirmação de dados

| Campo | Conteúdo |
|-------|----------|
| origem | Typebot `Confirmação de dados` |
| bloco | choice `plhspmybxbhylbfbsvqyhlmj` |
| pergunta | `Revise os dados informados.` / `Confirma que estão corretos para envio à avaliação médica?` |
| opções | `Confirmar dados` (sem value) |
| variável | — |
| próxima pretendida | Group #20 webhook |
| **DIVERGENTE** | item aponta `outgoingEdgeId`=`qdbm3l4g51y98mq9cyysegzw` (**MISSING**). Edge paralela `edge_confirm_to_webhook` existe mas **não** é a referenciada pelo item. |
| controla | **Typebot** |

### E20 — Criação do atendimento (webhook n8n → Backend)

| Campo | Conteúdo |
|-------|----------|
| ordem | 20 |
| origem | Typebot Webhook `axuwb907imxr22bqbnugj3ab` |
| bloco/input | Webhook POST |
| pergunta exata | — (automático) |
| URL | `https://n8n-staging-staging-2dfe.up.railway.app/webhook/typebot-webhook` |
| valor enviado | JSON com paciente/clínica/meds/termos/`protocol: staging-clinical-v1`/`typebot_public_id: doctor-prescreve-8rmljgu` |
| variável mapeada | `upload_url`, `upload_status_url`, `upload_status`, `atendimentoId` |
| próxima | E18 upload |
| controla | **Typebot** → **n8n** (`typebot-webhook-staging`) → **Backend** `POST /api/webhook/triagem` |
| fila | Backend cria atendimento (`origem: typebot-triagem`); status típico `awaiting_prescription_upload` ou `waiting` conforme regras de elegibilidade/pagamento/upload |

### E18 — Envio da receita anterior

| Campo | Conteúdo |
|-------|----------|
| ordem | 18 |
| origem | Typebot `Aguardando envio da receita` + Backend sobrescreve links externos |
| bloco/input | texto + choice `blk_upload_check` (`Conferir novamente`=`check`) |
| pergunta Typebot | `Envie agora uma foto legível ou um arquivo em PDF da sua receita anterior.` + requisitos + formatos |
| pergunta Backend (prioritária no Meta) | `Envie agora uma foto legível ou um arquivo em PDF da sua receita anterior nesta conversa do WhatsApp.` / `Formatos aceitos: JPG, JPEG, PNG ou PDF (até 10 MB).` |
| tipo | **mídia WhatsApp** (não file input Typebot) + choice conferir |
| valor | arquivo Meta → Backend; ou `Conferir novamente` |
| variável | `upload_check_action`, `upload_status`, `upload_completed`, `foto` via status |
| próxima | E19 |
| inválido | upload pendente: opções `Conferir novamente` / `Enviar novamente` / `Continuar depois` |
| controla | **Meta** + **Backend** (+ Typebot status poll) |
| **DIVERGENTE** | Typebot ainda menciona/mapeia `upload_url` de página externa; Backend Meta **substitui** por upload in-chat. |

### E19 — Retomada após upload

| Campo | Conteúdo |
|-------|----------|
| ordem | 19 |
| origem | Backend `resumeTypebotAfterPrescriptionUpload` |
| valor enviado ao Typebot | `Conferir novamente` |
| pergunta sucesso | `Receita anterior recebida e vinculada ao seu atendimento.` / `Estamos realizando a conferência final…` |
| próxima | E21 mensagem de fila |
| controla | **Backend** + **Typebot** + **Meta** |
| nota | Edge `edge_continue_later_to_end` **MISSING** no ramo “Continuar depois”. |

### E21 — Entrada na fila médica (mensagem ao paciente)

| Campo | Conteúdo |
|-------|----------|
| ordem | 21 |
| origem | Typebot Group #23 |
| pergunta / mensagem | `Recebemos suas informações e a foto da receita.` / `Um médico irá analisar seu caso em breve. Você será avisado por este WhatsApp.` |
| tipo | texto final Typebot (sem input) |
| variável | — |
| próxima | espera painel |
| controla | **Typebot** · atendimento já criado em E20 no Backend |
| nota | Status exato na fila (`waiting` vs outros) depende de `triagem-webhook.service.js` — detalhes finos **PENDENTE** neste doc além do já citado. |

### E22 — Reprovação e notificações

| Campo | Conteúdo |
|-------|----------|
| ordem | 22 |
| origem | Painel → `POST /api/atendimentos/:id/clinical/reject` |
| pergunta | — (outbound) |
| mensagem **efetiva no Backend** | `Após análise médica, sua solicitação não foi aprovada. O estorno do pagamento será processado e poderá ser concluído em até 72 horas, conforme os prazos da instituição financeira.` |
| caminho | `enqueueClinicalRejection` (outbox `whatsapp_messages`) → Meta |
| controla | **Backend** + **Meta** |
| n8n | Workflow `clinical-rejection-notify-staging` existe (`/webhook/clinical-rejection-notify` → `/api/whatsapp/notify-text`), mas `notifyClinicalRejection()` **não é chamado** por outros módulos `src/` — **DIVERGENTE** vs STATUS (“n8n… notificações”). |
| **DIVERGENTE** | Texto default no JSON n8n ≠ texto Backend ≠ texto em `n8n-clinical-notify.service.js`. |

### E23 — Entrega da receita

| Campo | Conteúdo |
|-------|----------|
| ordem | 23 |
| origem | n8n `prescription-delivery-staging` **ou** chamada direta Backend |
| fluxo n8n | POST `/webhook/prescription-delivery-staging` → Backend `POST /api/atendimentos/{id}/deliver` |
| mensagem | `Olá, {nome}. Sua receita Doctor Prescreve foi validada pelo médico e está disponível neste link: {receiptUrl}` |
| controla | **n8n** (opcional) + **Backend** + **Meta** (`WHATSAPP_PROVIDER=meta`) |
| nota | Nenhum caller em `src/` referencia a URL do webhook n8n de delivery — quem dispara pode ser painel/ops — **PENDENTE DE DEFINIÇÃO** o trigger operacional exato. |

### E24 — Suporte

| Campo | Conteúdo |
|-------|----------|
| ordem | 24 |
| origem | Backend menu opção `2` |
| pergunta / mensagens | `Aguarde, em breve nossa equipe realizará seu atendimento.` + `*0* - Voltar ao menu inicial` / `*ENCERRAR* - Encerrar atendimento` |
| tipo | fila suporte (sem Typebot) |
| opções | `0` / `ENCERRAR` / mensagens enquanto na fila |
| variável | atendimento suporte |
| próxima | encerra suporte → paciente precisa reenviar trigger de menu (`Oi` etc.) |
| pós-finalização painel | `Seu atendimento de suporte foi finalizado.` + `*1* - Encerrar` / `*2* - Iniciar avaliação…` |
| controla | **Backend** + **Meta** |
| nota | Entrar em suporte **limpa** sessão Typebot. |

### E25 — Encerramento e retorno ao menu

| Campo | Conteúdo |
|-------|----------|
| ordem | 25 |
| origem | Backend |
| gatilhos | `Oi`/`Olá`/`MENU`/`0`/`ENCERRAR` (fora de suporte ativo) limpam Typebot e reexibem E01 |
| suporte | `ENCERRAR`/`0` → `Atendimento de suporte encerrado. Obrigado pelo contato.` (menu **não** é reenviado automaticamente) |
| ramos Typebot de fim | LGPD negado · tempo &lt;1 mês · sinais · elegibilidade Não · sem receita · telemedicina Não · Group #23 sucesso |
| controla | **Backend** + **Typebot** (fins) + **Meta** |

---

## Contagem

| Métrica | Quantidade |
|---------|------------|
| Etapas registradas (E01–E25 + subetapas nomeadas E13b, E15.a–e) | **30** entradas de etapa na tabela mestre (25 tópicos obrigatórios cobertos; pagamento/meds na ordem real) |
| Perguntas ao paciente (inputs que esperam resposta) | **28** no happy path com 1 medicamento (menu + bem-vindo + LGPD + nome social + doença + tempo + sinais + tele + elegib. + 5 dados + CEP + endereço + receita + termos + pagamento/conferências + qtd + nome + dose + freq + via + confirmar + conferir upload). Com 2–3 meds: +4 ou +8 perguntas. |
| Etapas só sistema (webhook/Stripe/reject/deliver/fila) | E17, E20, E21 (texto), E22, E23 |

*Contagem de perguntas do happy path 1 med = 28 inputs/choices paciente-facing listados acima (pagamento conta como etapa interativa Backend).*

---

## Divergências reais

1. **Edge endereço quebrada no JSON do repo:** bloco `q78qjnk6ticwkeifl7xe2rju` → `b0xx8xgpeppttigdubv0bm9a` inexistente; `edge_dados_to_receita.from.blockId` truncado. STATUS diz “corrigido”.
2. **Via de administração:** STATUS/teste = Oral/Sublingual/Tópica/Inalatória/Outra e sessão não avança com `Oral`; JSON main = `Via oral` / `Outra via`.
3. **Confirmação de dados:** item `Confirmar dados` aponta edge inexistente `qdbm3l4g51y98mq9cyysegzw` (edge boa `edge_confirm_to_webhook` não referenciada).
4. **Roteamento `medication_count`:** conditions usam `"1"`/`"2"`/`"3"` com aspas literais vs values `1`/`2`/`3`.
5. **Ordem pagamento × medicamentos:** no Typebot, pagamento é **antes** dos medicamentos; lista mental “meds depois pagamento” só após Stripe resume.
6. **Upload:** Typebot mapeia `upload_url` externo; Backend Meta força upload in-chat e texto próprio.
7. **Rejeição clínica:** caminho vivo = Backend outbox; n8n `clinical-rejection-notify-staging` existe mas serviço não é wired; **3 textos** diferentes.
8. **Nome social:** variableId ausente de `variables[]`.
9. **Webhook fields** `continuous_use_days` / `has_warning_signs` / `payment_status` Typebot: não setados no fluxo.
10. **Elegibilidade choice:** values literais `{{SIM}}` / `{{NÃO}}` sem variável.
11. **Edge** `edge_continue_later_to_end` ausente.
12. **Group #24** órfão com edge missing (fora do happy path).

---

## Blocos que podem travar ou repetir

| Bloco / ponto | Risco |
|---------------|-------|
| `q78qjnk6ticwkeifl7xe2rju` (endereço) | Trava se edge missing no schema da sessão |
| `plhspmybxbhylbfbsvqyhlmj` (confirmar dados) | Trava pós-confirmar (edge missing) |
| `blk_nggi0xs0` (via) | Trava atual no teste humano; mismatch label/schema |
| `grp_route_after_med1/2` | Pode não sair se condition `"1"` ≠ `1` |
| Multi-choice doença/sinais | Repete lista até `Confirmo` |
| Pagamento pendente | Loop Conferir/Abrir/Cancelar |
| Upload pendente | Loop Conferir/Enviar novamente |
| Menu vs sessão ativa | `Oi`/`MENU` **interrompem** e limpam Typebot |
| Welcome + saudação | Backend pode reiniciar `startChat` se expected = welcome id |

---

## Edges inexistentes ou incompatíveis

| ID | Problema |
|----|----------|
| `b0xx8xgpeppttigdubv0bm9a` | Referenciado pelo endereço; **não existe** |
| `edge_dados_to_receita` | `from.blockId` truncado `q78qjnk6ticw` |
| `qdbm3l4g51y98mq9cyysegzw` | Referenciado por Confirmar dados; **não existe** |
| `edge_confirm_to_webhook` | Existe, mas item não aponta para ele |
| `edge_continue_later_to_end` | Referenciado; **não existe** |
| `dfdw7exk4j7d1jyr333lfrpr` | Group #24 órfão |
| `edge_medcount_to_med1_b` / `_c` | Órfãs / não usadas pelos items |

---

## Labels, values ou variáveis incompatíveis

| Local | Detalhe |
|-------|---------|
| Via (STATUS vs JSON) | Oral… vs `Via oral`/`Outra via` |
| Via sessão viva | Schema congelado ≠ JSON desejado |
| `medication_count` route | `"1"` vs `1` |
| Elegibilidade | `{{SIM}}`/`{{NÃO}}` |
| Nome social | variableId sem nome em `variables[]` |
| Tempo de uso / dados | literais `{{tempo_uso}}` / `{{dados_pessoais}}` no richText |
| Frequência/via (JSON main) | items sem `value` (content-only match) |
| Rejeição | 3 mensagens distintas Backend/n8n/service |

---

## Encerramentos Typebot (sem retorno automático ao menu)

Texto comum de inelegibilidade presencial (vários grupos):  
`Não foi possível continuar com a renovação por teleconsulta.` / `Pelas informações fornecidas, não será possível seguir com a renovação por teleconsulta neste momento. Recomendamos atendimento médico presencial para melhor avaliação.`

LGPD negado · telemedicina negada · Group #23 sucesso: textos específicos nas seções acima. Retorno ao menu = Backend E25.
