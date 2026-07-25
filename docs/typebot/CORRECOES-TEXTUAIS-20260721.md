# Doctor Prescreve — Correções textuais e de apresentação

**Data/hora de publicação:** 2026-07-21 (pedido isolado e econômico, só texto — nenhuma lógica/variável/edge alterada)

---

## Identificação

| Campo | Valor |
|-------|-------|
| Typebot ID (interno) | `higij2z0xihxxkr378rmljgu` |

---

## Blocos alterados

### 1. Botão inicial
| Campo | Valor |
|-------|-------|
| Grupo | `kinRXxYop2X4d7F9qt8WNB` (Bem-Vindo) |
| Bloco | `sbjZWLJGVkHAkDqS4JQeGow` (choice input), item `hQw2zbp7FDX7XYK9cFpbgC` |
| Antes | "Iniciar Atendimento" |
| Depois | **"Vamos começar"** |

### 2. Pergunta sobre condição clínica
| Campo | Valor |
|-------|-------|
| Grupo | `vo62j813iek8fjy0uoq0ttrc` (Doença Crônica) |
| Bloco | `hda2dcvh33856qga899drcfi` |
| Antes | "Olá, você faz tratamento para:" |
| Depois | **"Para qual destas condições você utiliza medicação contínua?"** |

### 3. Texto de telemedicina
| Campo | Valor |
|-------|-------|
| Grupo | `grp_telemedicina_consent` (Telemedicina e não urgência) |
| Bloco | `blk_tele_intro` |
| Antes | "Este atendimento é uma teleconsulta assíncrona para avaliação de renovação de receita. Não substitui atendimento presencial em casos de urgência ou emergência." |
| Depois | **"Este atendimento é uma consulta médica por telemedicina para avaliar a continuidade de medicamentos de uso crônico.\n\nO médico analisará posteriormente as informações e os documentos enviados. A emissão da receita dependerá da avaliação médica e poderá ser recusada quando não houver segurança clínica."** |

### 4. Critérios de elegibilidade
| Campo | Valor |
|-------|-------|
| Grupo | `fni2p22kfg51hs6s6lhcteec` (Declaração de elegibilidade) |
| Bloco | `iw6zqwf26frmqnp1csxiwlbm` |
| Antes | "📋 CRITÉRIOS DE ELEGIBILIDADE / Para continuar, confirme que: / • possui diagnóstico prévio de pelo menos uma das condições selecionadas • utiliza continuamente a medicação • não apresenta sinais de alerta neste momento • as informações fornecidas são verdadeiras • compreende que a emissão da receita depende da avaliação médica / Você confirma essas informações?" |
| Depois | **"CRITÉRIOS DE ELEGIBILIDADE / Para continuar, confirme que: / • tem entre 18 e 80 anos; • possui diagnóstico prévio de uma doença crônica atendida pelo Doctor Prescreve; • utiliza a medicação de forma contínua há mais de 30 dias; • não apresenta sinais ou sintomas de alerta neste momento; • possui receita anterior válida ou documento compatível; • a receita anterior foi emitida há no máximo 180 dias; • as informações fornecidas são verdadeiras; • compreende que a emissão da receita depende da avaliação médica. / Você confirma essas informações?"** |

Botões "Sim"/"Não" do bloco seguinte — inalterados (nenhum choice block deste grupo foi tocado).

### 5. Termos e pagamento — "taxa de avaliação médica" → "consulta médica"
| Campo | Valor |
|-------|-------|
| Grupo | `grp_gate_pagamento` (Gate elegível pagamento) |
| Bloco | `blk_gate_txt` |
| Antes | "Triagem aprovada. Leia os termos antes do pagamento da taxa de avaliação médica." |
| Depois | **"Triagem aprovada. Leia os termos antes do pagamento da consulta médica."** |

Confirmada única ocorrência da expressão em todo o Typebot (busca no JSON completo publicado).

### Não incluído neste pedido (por decisão do usuário)
**Resumo final — mascarar CPF**: bloco `k0i76xzc7cs84de90o94oy9i` (grupo "Confirmação de dados") usa `{{cpf_paciente}}` — substituição direta e completa da variável. Mascarar (`123.***.***-09`) exigiria uma variável nova computada (Set variable), o que o usuário optou por não autorizar neste pedido "só texto". **Pendência registrada** para um pedido futuro que autorize essa mudança estrutural mínima.

---

## Validação

- Backup completo do Typebot antes da alteração (ver arquivo abaixo).
- Todas as 5 alterações passaram por assertion de igualdade estrita contra o texto atualmente publicado, ANTES de qualquer PATCH — qualquer divergência interromperia o script sem publicar nada.
- Snapshot estrutural (ids de grupos, blocos, edges e variáveis) capturado antes e comparado byte-a-byte depois — **nenhum id foi criado, removido ou alterado**.
- PATCH (200) + publish (200).
- Reverificação independente: nova consulta GET ao Typebot publicado, confirmando os 5 textos exatamente como esperado, os `id`/`outgoingEdgeId` do botão inicial e do bloco de gate preservados, e o snapshot estrutural idêntico ao de antes da publicação.

## Backups

- Antes: `backups/typebot-doctor-prescreve-antes-20260721-textual.json`
- Depois: `backups/typebot-doctor-prescreve-depois-20260721-textual.json`

## Testes mínimos

- Nenhum teste automatizado de backend aplicável (pedido é 100% conteúdo Typebot, sem código).
- Validação = assertions de texto exato (pré-publicação) + reverificação independente pós-publicação, ambas registradas no log de execução do script de patch.

## Não incluído nesta alteração

- Nenhum arquivo de Backend, painel, pagamento, upload, Memed, suporte ou elegibilidade foi tocado.
- Nenhuma variável, `variableId`, `blockId`, `groupId` ou `edge` foi criado, renomeado ou removido.
- Nenhuma lógica clínica foi modificada — apenas texto exibido ao paciente.
