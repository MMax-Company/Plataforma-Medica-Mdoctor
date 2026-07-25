# Doctor Prescreve — Correção do resumo clínico (condição/medicamentos vazios)

**Data/hora de publicação:** 2026-07-21 (pedido isolado e econômico)

---

## Identificação

| Campo | Valor |
|-------|-------|
| Typebot ID (interno) | `higij2z0xihxxkr378rmljgu` |
| Grupo | `wupo36l29a2x66rh0bwf5yex` (Confirmação de dados) |

---

## Causa raiz

`blk_resumo_set_condicoes` e `blk_resumo_set_medicamentos` (blocos "Set variable" com código customizado, adicionados na Fase 1 Pedido 4) escreviam a interpolação de variável **entre aspas** dentro do `expressionToEvaluate`:

```js
var raw = '{{doenca_cronica}}';           // errado
var meds = [{ nome: '{{med1_nome}}', ... }]; // errado
```

Segundo a documentação oficial do Typebot ([Set variable](https://docs.typebot.io/editor/blocks/logic/set-variable)), variáveis dentro de código customizado são avaliadas como JavaScript real, **não** como template string — `{{variável}}` deve ser escrito **sem aspas ao redor**; o próprio Typebot substitui pelo valor já em formato JS válido (string já quotada, ou `undefined` quando não preenchida). Colocar aspas manualmente ao redor produz uma string incorreta (contendo chaves/aspas residuais), o que quebra o parsing subsequente (`split`, `map`, comparação de igualdade) e resulta no valor final vazio ou incorreto — exatamente o sintoma relatado ("Condição(ões): vazio; Medicamentos: vazio").

Isso explica também por que os OUTROS campos do resumo (Nome, CPF, WhatsApp, E-mail, CEP, Endereço) sempre exibiram corretamente: eles usam `{{variável}}` diretamente no texto (interpolação simples, sempre suportada), não dentro de código customizado.

Confirmado por leitura de código (nomes de variáveis e ordem dos grupos/edges já estavam corretos) e por simulação local das duas versões da expressão (com e sem aspas) com valores de exemplo.

## Blocos e variáveis reaproveitados (nenhum novo)

| Bloco | Tipo | Variável (inalterada) |
|-------|------|------------------------|
| `blk_resumo_set_condicoes` | Set variable | `var_resumo_condicoes` (`resumo_condicoes`) |
| `blk_resumo_set_medicamentos` | Set variable | `var_resumo_medicamentos` (`resumo_medicamentos`) |

Variáveis de origem, já existentes e coletadas nos blocos correspondentes — nenhuma criada: `doenca_cronica`, `medication_count`, `med1_nome`/`med1_dose`/`med1_frequencia`/`med1_via`, `med2_*`, `med3_*`.

## Alteração realizada

Só o texto de `expressionToEvaluate` dos dois blocos — removidas as aspas ao redor de cada `{{variável}}`; lógica de mapeamento/formatação preservada (mesma estrutura, mesmos rótulos de condição, mesmo formato "nome — dose — frequência — via"). Nenhum `variableId`, `blockId`, `groupId` ou `edge` foi alterado.

## Exemplos do resumo (simulados localmente antes da publicação)

**1 medicamento:**
```
Condição(ões): Hipertensão arterial
Medicamentos:
1. Captopril — 25 mg — Duas vezes ao dia — Via oral
```

**2 medicamentos:**
```
Condição(ões): Hipertensão arterial, Diabetes mellitus
Medicamentos:
1. Captopril — 25 mg — Duas vezes ao dia — Via oral
2. Losartana — 50 mg — Uma vez ao dia — Via oral
```

**3 medicamentos:**
```
Condição(ões): Hipertensão arterial, Diabetes mellitus
Medicamentos:
1. Captopril — 25 mg — Duas vezes ao dia — Via oral
2. Losartana — 50 mg — Uma vez ao dia — Via oral
3. Metformina — 850 mg — Três vezes ao dia — Via oral
```

Campos não preenchidos (dose/frequência/via ausentes) são omitidos da linha correspondente; medicamento sem nome nunca aparece; contagem sempre limitada a `medication_count` (1 a 3), nunca mostrando o medicamento 2/3 quando a quantidade for 1.

## Não incluído neste pedido

- **CPF**: mantido exatamente como está (`{{cpf_paciente}}`, valor completo) — sem alteração, por decisão explícita do usuário.
- Ordem da receita anterior, pagamento, upload, painel, Memed, suporte, elegibilidade, integrações, e as correções textuais do pedido anterior (botão inicial, pergunta de condição, telemedicina, critérios de elegibilidade, "consulta médica") — todos verificados intactos na reverificação.
- **Achado fora de escopo, não corrigido**: os blocos `blk_med1_freq_intervalo`, `blk_med2_freq_intervalo`, `blk_med3_freq_intervalo` (grupos "Medicamento 1/2/3", usados para formatar intervalo de frequência, provavelmente para uso futuro no payload Memed) têm a **mesma causa raiz** (aspas ao redor da interpolação). Não fazem parte do "resumo" e não foram tocados neste pedido — registrado como pendência para avaliação futura, caso esses valores estejam sendo consumidos incorretamente em algum outro lugar.

---

## Validação

- Backup completo do Typebot antes da alteração.
- Assertions confirmaram a causa raiz (aspas presentes) ANTES de editar, e a ausência delas DEPOIS — qualquer divergência interromperia o script sem publicar.
- Snapshot estrutural (`groupIds`/`blockIds`/`edgeIds`/`variableIds`) idêntico antes e depois — nenhum id criado, removido ou alterado.
- PATCH (200) + publish (200).
- Reverificação independente: nova leitura do Typebot publicado confirmando as duas expressões exatas, `variableId`s preservados, e as correções textuais do pedido anterior (botão inicial, "consulta médica") intactas — confirmando ausência de regressão.

## Backups

- Antes: `backups/typebot-doctor-prescreve-antes-20260721-resumo.json`
- Depois: `backups/typebot-doctor-prescreve-depois-20260721-resumo.json`

## Testes

- Simulação local das duas expressões (versão com bug reproduzindo a causa raiz, e versão corrigida) com múltiplos formatos de entrada plausíveis e os 3 cenários de 1/2/3 medicamentos — todos corretos na versão corrigida.
- Nenhum teste automatizado de backend aplicável (pedido 100% Typebot).
