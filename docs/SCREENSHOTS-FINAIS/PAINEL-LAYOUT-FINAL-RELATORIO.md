# Painel Médico — Layout final — fechamento painel central

**Gerado em:** 2026-05-30T22:58:28.952Z
**Rota:** `/fila?visualSim=1`
**Viewport:** 1280×720 (1920×1080 @ Windows 150%)

## Artefatos

- `02-painel-medico-final.png`
- `painel-layout-final-depois-1280x720.png`
- `painel-layout-final-antes-1280x720.png`
- `painel-layout-final-antes-depois.png`

## Validação

| Check | Resultado |
|-------|-----------|
| Overflow vertical | OK |
| Overflow horizontal | OK |
| Header presença (74px) | OK |
| Badges coluna vermelho fechado | OK |
| CTAs altura uniforme (40px) | OK |
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
  }
]
```

## Escopo

Matriz laranja, badges/SAIR vermelho fechado (#B4232A), header 74px em 3 grupos, iniciais nome+sobrenome, ID ATD-*, micro botão contato. Sem alteração de APIs, auth ou elegibilidade.
