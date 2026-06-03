# Teste operacional — 10 pacientes fictícios

**Confirmação:** validação visual/operacional do painel com densidade clínica realista (`?visualSim=1`).

**Gerado em:** 2026-05-30T19:00:03.006Z
**Painel:** http://127.0.0.1:3001
**Login:** API

## Distribuição (10 pacientes)

| Coluna | Qtd | Pacientes |
|--------|-----|-----------|
| Fila de espera | 6 | Roberto Alves, Fernanda Costa, Marcos Oliveira, Eduardo Lima, Juliana Rocha, Carla Dias |
| Em atendimento | 3 | Ricardo Souza, Amanda Ferreira, Gustavo Nunes |
| Receitas prontas | 1 | Patrícia Mendes |

## Elegibilidade (motor clínico — sem marcação prévia nos cards)

| Grupo | IDs | Cenário |
|-------|-----|---------|
| Elegíveis (4) | p01–p04 | HAS, DM2, HAS+HIPO, DLP com documentação e janela de receita ok |
| Não elegíveis (6) | p05–p10 | Receita >180d, uso <30d, sem foto, alerta, controlado, condição fora do protocolo |

## Checklist visual

| Glitch visual? | **Não** |
| Overflow horizontal? | **Não** |
| Desalinhamento? | **Não** |
| Componente quebrado? | **Não** |
| Piloto fechado? | **Compatível** |

## Prontuários capturados

- Elegível: `/prontuario/vis-sim-p01` (Roberto Alves — HAS)
- Não elegível: `/prontuario/vis-sim-p08` (Amanda Ferreira — sinais de alerta)

## Artefatos

- `01-painel-10-pacientes.png`
- `02-prontuario-elegivel.png`
- `03-prontuario-nao-elegivel.png`
- `comparacao-visual-geral.png`

## Observações

- Dados em `src/lib/visual-simulation-fila.ts`; ativação via `?visualSim=1`.
- Elegibilidade decidida pelo endpoint `/api/eligibility` (motor existente).
- ATENDER em pacientes sim atualiza status localmente após triagem automática.
- Sem alteração de layout, cores, handlers de produção ou APIs novas.
