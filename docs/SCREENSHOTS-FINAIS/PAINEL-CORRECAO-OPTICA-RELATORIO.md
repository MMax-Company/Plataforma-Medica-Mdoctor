# Painel Médico — Correção óptica definitiva

**Gerado em:** 2026-05-30T22:48:14.057Z
**Rota:** `/fila?visualSim=1`
**Viewport:** 1280×720 (1920×1080 @ Windows 150%)

## Artefatos

- `02-painel-medico-final.png`
- `painel-correcao-depois-1280x720.png`
- `painel-correcao-antes-1280x720.png`
- `painel-correcao-antes-depois.png`

## Validação

| Check | Resultado |
|-------|-----------|
| Overflow vertical | OK |
| Overflow horizontal | OK |
| Header presença (70px) | OK |
| CTAs altura uniforme (40px) | REVISAR |
| CTAs primários mesma largura | OK |
| Logo sem caixa tinta | OK |
| Botão PRONTUÁRIO | OK |
| Fila + suporte | OK |
| Botão verde ≈ laranja (172px slot) | OK |

## CTAs primários (amostra)

```json
[
  {
    "w": 172,
    "h": 40
  },
  {
    "w": 172,
    "h": 40
  },
  {
    "w": 172,
    "h": 40
  },
  {
    "w": 172,
    "h": 40
  },
  {
    "w": 172,
    "h": 40
  },
  {
    "w": 172,
    "h": 40
  },
  {
    "w": 153,
    "h": 40
  },
  {
    "w": 153,
    "h": 40
  },
  {
    "w": 153,
    "h": 40
  },
  {
    "w": 172,
    "h": 40
  }
]
```

## Escopo

Matriz laranja, badges vermelhos, SAIR vermelho, header 70px, iniciais nome+sobrenome, ID ATD-*, micro botão contato. Sem alteração de APIs, auth ou elegibilidade.
