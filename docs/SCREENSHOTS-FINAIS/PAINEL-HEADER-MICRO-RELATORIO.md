# Painel Médico — Header institucional — microajuste óptico

**Gerado em:** 2026-05-30T23:28:43.883Z
**Rota:** `/fila?visualSim=1`
**Viewport:** 1280×720 (1920×1080 @ Windows 150%)

## Artefatos

- `02-painel-medico-final.png`
- `painel-header-micro-depois-1280x720.png`
- `painel-header-micro-antes-1280x720.png`
- `painel-header-micro-antes-depois.png`

## Validação

| Check | Resultado |
|-------|-----------|
| Overflow vertical | OK |
| Overflow horizontal | OK |
| Header presença (110px) | OK |
| Cards exibem iniciais (não nome completo) | OK |
| Faixa suporte discreta (≤68px) | OK |
| CTA verde linha única | OK |
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
