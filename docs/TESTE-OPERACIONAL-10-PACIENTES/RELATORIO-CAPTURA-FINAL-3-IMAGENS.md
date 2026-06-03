# Captura final — 3 imagens oficiais

**Confirmação:** capturas reais autenticadas do estado atual do Doctor Prescreve (1366×768).

**Gerado em:** 2026-05-30T19:05:39.936Z
**Painel:** http://127.0.0.1:3001
**Login:** API (painel/prontuário); login sem sessão

## Imagens entregues

| # | Arquivo | Rota |
|---|---------|------|
| 01 | `01-login-acesso-atual.png` | `/login` |
| 02 | `02-painel-medico-10-pacientes-atual.png` | `/fila?visualSim=1` |
| 03 | `03-prontuario-eletronico-atual.png` | `/prontuario/vis-sim-p01` (Roberto Alves — elegível) |

## Confirmações

| Item | Resultado |
|------|-----------|
| Capturas reais (produto rodando local)? | **Sim** |
| Painel com 10 pacientes? | **Sim** (10 cards detectados) |
| Distribuição 6+3+1? | **Sim** |
| Overflow horizontal? | **Não** |
| Glitch visual / loading na captura? | **Não** |
| Aptas para apresentação interna? | **Sim** |

## Observações

- Login capturado sem sessão ativa (tela de acesso institucional).
- Painel usa simulação operacional `visualSim=1` (10 pacientes + faixa suporte).
- Prontuário: paciente elegível do teste; banner VERIFICADO via motor `/api/eligibility`.
- Nenhuma alteração de layout, código ou fluxo nesta etapa — somente captura.
