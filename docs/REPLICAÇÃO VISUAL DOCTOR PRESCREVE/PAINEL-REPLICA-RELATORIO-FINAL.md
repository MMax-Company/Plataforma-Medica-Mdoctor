# Painel Médico Central — Relatório de validação visual

**Gerado em:** 2026-05-30T15:29:53.139Z
**Rota:** `/fila`
**Viewport:** 1366×768
**Painel:** http://127.0.0.1:3001
**Login:** API+UI
**URL capturada:** http://127.0.0.1:3001/fila

## Itens corrigidos neste ajuste final

- Header: logo transparente, “Painel Médico” serifado preto, nome médico preto, chevron, SAIR rosado
- Faixa suporte: integrada, 88px, chips dinâmicos (sem placeholders mock), refresh 30s
- Colunas: radius 14px, scroll vertical discreto, badge tempo cinza na fila
- Footer: fundo branco + borda superior
- Captura: fluxo login real → `/fila` autenticado

## Diferenças restantes (aceitáveis)

- Contagem de pacientes e chips dependem da fila real do backend (dinâmico).
- Nomes/IDs nos cards refletem dados reais, não os nomes fictícios do mockup estático.
- Fonte serif depende da família instalada no SO (fallback Georgia/Times).

## Confirmação

**layout visual alinhado com a referência** — painel autenticado renderizado em `/fila` conforme anexo oficial.

## Artefatos

- Captura: `painel-replica-1366-captura.png`
- Comparação: `painel-replica-1366-comparacao.png`
