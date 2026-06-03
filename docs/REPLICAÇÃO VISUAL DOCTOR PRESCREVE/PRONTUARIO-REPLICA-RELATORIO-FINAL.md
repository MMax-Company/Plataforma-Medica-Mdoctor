# Prontuário Médico — Relatório de validação visual

**Gerado em:** 2026-05-30T15:32:29.989Z
**Rota:** `/prontuario/095d8d4a-1d99-47ba-b7d0-3f774b119d6f`
**Viewport:** 1366×768
**Painel:** http://127.0.0.1:3001
**Login:** API
**URL capturada:** http://127.0.0.1:3001/prontuario/095d8d4a-1d99-47ba-b7d0-3f774b119d6f

## Refinamentos aplicados

- Header: logo transparente, Dr. Max Matos preto, Administrador cinza, SAIR rosado
- Topo: voltar + título/subtítulo centralizados, banner elegibilidade 64px
- Colunas 30/70: dados paciente + história clínica com blocos na ordem da referência
- Botões RECEITA ANEXADA / EDITAR com mesma altura (48px)
- Barra decisão: REPROVAR | conduta opcional | APROVAR (72px)
- Footer discreto com borda superior
- Captura: autenticação real + atendimento da fila operacional

## Diferenças restantes (aceitáveis)

- Textos clínicos e dados do paciente vêm do atendimento real (não do mock estático da referência).
- Presença de RECEITA ANEXADA depende de foto_receita_url no atendimento.
- Scroll vertical na história clínica só aparece se o conteúdo exceder a altura útil.

## Confirmação

**layout visual alinhado com a referência oficial** — prontuário autenticado renderizado com dados reais.

## Artefatos

- `prontuario-replica-1366-captura.png`
- `prontuario-replica-1366-comparacao.png`
