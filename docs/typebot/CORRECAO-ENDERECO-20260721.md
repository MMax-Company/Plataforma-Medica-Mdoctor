# Doctor Prescreve — Correção pontual: bloco de endereço

**Data/hora de publicação:** 2026-07-21 08:33 UTC
**Contexto:** correção ao vivo durante o teste humano final (+55 11 99169-0401 → +55 11 94570-4946), autorizada pelo usuário ("checar e corrigir").

---

## Identificação

| Campo | Valor |
|-------|-------|
| Typebot ID (interno) | `higij2z0xihxxkr378rmljgu` |
| Grupo | `od03hfeq73l5xvs0lj9xrox3` — Dados Pessoais |
| Bloco de pergunta | `blk_pergunta_endereco` |
| Bloco de input | `q78qjnk6ticwkeifl7xe2rju` (text input, variableId `vi35p4gd73v2cuk9ai4jw2irs`, outgoingEdgeId `edge_dados_to_route_check`) |

---

## Alteração aplicada

| Campo | Antes | Depois |
|-------|-------|--------|
| Pergunta | "Qual é o seu endereço?" | **"Qual é o seu endereço completo?"** |
| Placeholder do input | "Rua, número e bairro" | **"Rua, número, bairro, cidade e UF"** |

Nenhum outro campo do bloco (`variableId`, `outgoingEdgeId`, tipo, estrutura do grupo) foi alterado. Nenhum outro bloco/grupo/edge do Typebot foi tocado.

## Motivo

O placeholder original pedia só "Rua, número e bairro", mas a validação do Backend (`typebot-personal-data.validation.js` → `validateStructuredAddress`) sempre exigiu também cidade e estado (UF). Qualquer paciente que seguisse literalmente a instrução da tela ficava preso em loop de revalidação. Esta correção alinha o texto do bloco com o que a validação realmente exige.

Complementarmente, a causa raiz do travamento observado no teste (paciente escrevendo cidade+UF sem vírgula entre eles, ex. "Sao Paulo SP") foi corrigida no Backend — ver commit `b8dfc4f` (`typebot-clinical-data.validation.js`). As duas correções são independentes e complementares.

## Validação

- Dry-run com assertions antes do PATCH (texto/placeholder aplicados corretamente, `variableId` e `outgoingEdgeId` preservados).
- PATCH + publish via API (`https://app.typebot.com/api/v1/typebots/{id}`), status 200.
- Reverificação independente: nova consulta GET ao Typebot publicado confirmando pergunta e placeholder exatamente como esperado.

## Backups

- Antes: `backups/typebot-doctor-prescreve-antes-livefix-20260721-endereco.json`
- Depois: `backups/typebot-doctor-prescreve-depois-livefix-20260721-endereco.json`

## Não incluído nesta alteração

- Nenhuma outra alteração no Typebot foi feita após esta publicação.
- A correção do parser de endereço no Backend está registrada separadamente no commit `b8dfc4f` (código, não Typebot).
