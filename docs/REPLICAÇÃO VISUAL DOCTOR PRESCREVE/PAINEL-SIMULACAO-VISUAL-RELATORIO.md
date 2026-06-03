# Painel Médico Central — Simulação visual final (10 pacientes)

**Gerado em:** 2026-05-30T15:39:21.929Z
**Rota:** `/fila?visualSim=1`
**Viewport:** 1366×768
**Painel:** http://127.0.0.1:3001
**Login:** API+UI
**URL capturada:** http://127.0.0.1:3001/fila?visualSim=1

## Distribuição simulada

| Coluna | Qtd | Pacientes |
|--------|-----|-----------|
| FILA DE ESPERA | 5 | Lucas M., Ana C., Pedro S., Carla R., Felipe D. |
| EM ATENDIMENTO | 3 | Mariana L., Rafael T., Juliana P. |
| RECEITAS PRONTAS | 2 | Bruno A., Camila F. |
| Suporte (faixa) | 6 chips | Helena K., Igor V., Larissa N., Otávio B., Patrícia G., Renato H. |

## Checklist visual (objetivo)

| Pergunta | Resultado |
|----------|-----------|
| Existe overflow horizontal? | **Não** |
| Existe quebra visual das colunas? | **Não** |
| Existe desalinhamento de botões? | **Não** |
| Existe esmagamento de cards? | **Não** |
| Painel continua proporcional? | **Sim** |
| Layout continua premium/médico? | **Sim** |
| Scroll vertical elegante nas colunas? | **Sim** (fila com 5 cards — scroll interno visível) |
| Adequado para notebook 1366×768? | **Sim** |

## Observações

- 10 pacientes fictícios distribuídos 5 + 3 + 2 nas colunas existentes.
- Faixa de suporte mantida com 6 chips e contador coerente.
- Coluna **FILA DE ESPERA** (5 cards) ativa scroll vertical interno; demais colunas cabem sem scroll neste viewport.
- Sem overflow horizontal no viewport 1366×768.
- Botões ATENDER, VISUALIZAR/ACEITAR e entrega mantêm classes e alturas originais; simulação não chama APIs.

## Modo de ativação (somente visual)

- Query string: `?visualSim=1` após login
- Dados fictícios em `src/lib/visual-simulation-fila.ts`
- Ações em IDs `vis-sim-*` não disparam APIs (guards no cliente)
- Sem alteração de layout, cores, header, footer, faixa suporte, backend ou auth

## Artefatos

- `painel-simulacao-1366-captura.png`
- `painel-simulacao-1366-comparacao.png` (referência + baseline opcional + simulação)
