# Screenshots finais oficiais — Doctor Prescreve

**Confirmação:** estado visual oficial atual do Doctor Prescreve (capturas autenticadas, viewport 1366×768).

**Gerado em:** 2026-05-30T15:56:02.934Z
**Painel:** http://127.0.0.1:3001
**Login:** API+UI

## Artefatos

| # | Arquivo | Rota |
|---|---------|------|
| 01 | `01-login-final.png` | `/login` |
| 02 | `02-painel-fila-espera.png` | `/fila?visualSim=1` (foco coluna Fila de Espera) |
| 03 | `03-painel-em-atendimento.png` | `/fila?visualSim=1` (foco coluna Em Atendimento) |
| 04 | `04-painel-receitas-prontas.png` | `/fila?visualSim=1` (foco coluna Receitas Prontas) |
| 05 | `05-prontuario-medico-final.png` | `/prontuario/095d8d4a-1d99-47ba-b7d0-3f774b119d6f` |

## Painel — densidade operacional

- Painel (02–04): UI **100% real**; fila populada via `?visualSim=1` (10 pacientes representativos 5+3+2 + 6 suporte) porque a fila operacional ao vivo não atingia a densidade mínima para demonstração.

## Checklist visual

| Pergunta | Resultado |
|----------|-----------|
| Glitch visual? | **Não** |
| Overflow horizontal? | **Não** |
| Desalinhamento? | **Não** |
| Componente quebrado? | **Não** |
| Incompatível com piloto fechado? | **Não** |

## Medições por captura

- **02-painel-fila-espera.png:** overflow=não, loading=não, imgs quebradas=0
- **03-painel-em-atendimento.png:** overflow=não, loading=não, imgs quebradas=0
- **04-painel-receitas-prontas.png:** overflow=não, loading=não, imgs quebradas=0
- **05-prontuario-medico-final.png:** overflow=não, loading=não, imgs quebradas=0

## Observações

- Login e prontuário: captura direta do produto autenticado, sem composição fake.
- Painel: header, faixa suporte, footer e cards são o layout final atual.
- Modo `visualSim=1` usado apenas para densidade 5+3+2 na demonstração; não altera layout nem handlers.
- Prontuário atendimento: `095d8d4a-1d99-47ba-b7d0-3f774b119d6f`.
