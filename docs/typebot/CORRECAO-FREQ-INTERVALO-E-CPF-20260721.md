# Doctor Prescreve — Correção do intervalo de frequência + mascaramento do CPF

**Data/hora de publicação:** 2026-07-21 (pedido isolado e econômico)

---

## Identificação

| Campo | Valor |
|-------|-------|
| Typebot ID (interno) | `higij2z0xihxxkr378rmljgu` |

---

## 1. Intervalo de frequência (3 blocos)

**Causa raiz:** mesma já identificada e validada no resumo clínico — interpolação `{{variável}}` escrita **entre aspas** dentro do `expressionToEvaluate` de um bloco "Set variable" com código customizado, o que o Typebot avalia como JavaScript real (não template string), quebrando o valor.

| Bloco | Grupo | Variável (inalterada) |
|-------|-------|------------------------|
| `blk_med1_freq_intervalo` | Medicamento 1 | `var_med1_freq_intervalo` |
| `blk_med2_freq_intervalo` | Medicamento 2 | `var_med2_freq_intervalo` |
| `blk_med3_freq_intervalo` | Medicamento 3 | `var_med3_freq_intervalo` |

**Expressão anterior (exemplo medicamento 1):**
```js
(function(){ var f = '{{var_8uua327o}}'; if (f === 'Uma vez ao dia') return 'a cada 24 horas'; if (f === 'Duas vezes ao dia') return 'a cada 12 horas'; if (f === 'Três vezes ao dia') return 'a cada 8 horas'; return f; })()
```

**Expressão nova:**
```js
(function(){ var f = {{var_8uua327o}}; if (!f) return ''; if (f === 'Uma vez ao dia') return 'a cada 24 horas'; if (f === 'Duas vezes ao dia') return 'a cada 12 horas'; if (f === 'Três vezes ao dia') return 'a cada 8 horas'; return f; })()
```
(idêntico para os blocos 2 e 3, trocando só a variável de origem: `var_mb5cid9v`, `var_la7nbosl`)

Mudanças: (a) removidas as aspas ao redor da interpolação; (b) adicionada guarda `if (!f) return '';` para nunca produzir `undefined`/`null` quando o medicamento 2 ou 3 não estiver preenchido. `variableId`, `blockId`, `groupId` e lógica de mapeamento preservados.

**Exemplos validados (simulação local antes de publicar):**

| Entrada | Saída |
|---|---|
| Uma vez ao dia | a cada 24 horas |
| Duas vezes ao dia | a cada 12 horas |
| Três vezes ao dia | a cada 8 horas |
| (texto livre, ex. "1 comprimido a cada 6 horas") | mantido como está |
| (não preenchido — medicamento 2/3 quando só há 1) | `''` (vazio, nunca "undefined") |

---

## 2. Mascaramento do CPF no resumo

**Formato final:** `123.***.***-09` (3 primeiros + 2 últimos dígitos, restante mascarado).

**Por que precisou de 1 variável e 1 bloco novos:** o resumo exibia `{{cpf_paciente}}` por substituição direta em texto simples — Typebot não tem função de manipulação de string dentro de um bloco de texto. Não havia bloco/expressão existente reaproveitável para essa operação (confirmado antes de criar). Único item deste conjunto de pedidos com criação de estrutura nova, autorizada explicitamente pelo usuário ("não criar variável nova **se for possível** reutilizar").

| Item novo | Valor |
|---|---|
| Variável | `var_resumo_cpf_mascarado` (nome `resumo_cpf_mascarado`) |
| Bloco | `blk_resumo_set_cpf_mascarado` (Set variable), inserido no grupo `wupo36l29a2x66rh0bwf5yex` (Confirmação de dados), logo após `blk_resumo_set_medicamentos` — sem `edge` próprio (bloco intermediário sequencial, mesmo padrão dos outros 2 blocos "Set variable" do grupo) |

**Expressão:**
```js
(function(){ var cpf = String({{cpf_paciente}} || '').replace(/\D/g, ''); if (cpf.length !== 11) return '—'; return cpf.slice(0,3) + '.***.***-' + cpf.slice(9,11); })()
```

**Texto do resumo:**
| Antes | Depois |
|---|---|
| `CPF: {{cpf_paciente}}` | `CPF: {{resumo_cpf_mascarado}}` |

**A variável original `cpf_paciente` não foi tocada** — continua com o valor completo, usada normalmente por qualquer outro consumidor (Memed, backend, prontuário). Só a exibição no resumo passou a usar a versão mascarada.

**Exemplos validados (simulação local antes de publicar):**

| CPF original (entrada) | Exibido no resumo |
|---|---|
| `12345678909` | `123.***.***-09` |
| `529.982.247-25` (com pontuação) | `529.***.***-25` |
| não preenchido / inválido | `—` (nunca CPF completo, nunca vazio/undefined) |

---

## Não alterado (confirmado na reverificação)

- Coleta clínica, validação de CPF, busca de paciente, prontuário, integrações (Memed, Backend) — variável `cpf_paciente` original intacta.
- Medicamentos, elegibilidade, pagamento, upload, links jurídicos, painel, suporte.
- Nenhum `variableId`/`blockId`/`groupId`/`edge` **existente** foi alterado ou removido — só 1 variável e 1 bloco novos, ambos exclusivos do mascaramento do CPF.
- Correções dos pedidos anteriores de hoje (botão inicial, textos de condição/telemedicina/elegibilidade/pagamento, resumo de condições/medicamentos, links jurídicos) — todas confirmadas intactas.

---

## Backups

- Antes: `backups/typebot-doctor-prescreve-antes-20260721-freq-cpf.json`
- Depois: `backups/typebot-doctor-prescreve-depois-20260721-freq-cpf.json`

## Testes

- Simulação local das 4 expressões (3 de frequência + 1 de CPF) com múltiplos valores de entrada, incluindo os cenários pedidos (1x/2x/3x ao dia, texto livre, CPF com e sem pontuação, valor ausente) — todos corretos antes de publicar.
- Assertions automatizadas confirmando a causa raiz ANTES do PATCH e o resultado esperado DEPOIS, com reverificação independente via nova leitura do Typebot publicado.
- Snapshot estrutural: 0 grupos novos, 0 edges novos, exatamente 1 bloco novo e 1 variável nova (ambos do CPF mascarado, nenhum removido/renomeado) — confirmado antes e depois da publicação.
- Correções anteriores (todos os pedidos de hoje) reverificadas intactas.
