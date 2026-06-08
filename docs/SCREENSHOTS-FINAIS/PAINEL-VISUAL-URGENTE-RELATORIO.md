# Painel médico — correção visual urgente (staging)

**Data:** 2026-06-03  
**Deploy Railway:** `0c5962ae-60aa-4419-a7e9-ddb43b5cf24d`  
**URL:** https://painel-medico-staging-staging.up.railway.app/fila  
**Build local:** `5aa0f4c8` (branch `codex/legacy-compat-infra`)

## Problemas corrigidos

| # | Problema | Correção |
|---|----------|----------|
| 1 | Cards “Em atendimento” com texto sobre botões | Altura fixa 88px removida; layout em coluna (`--review-stack`); ações com `flex: 0 0 auto` e `z-index`; meta com line-clamp |
| 2 | “Receitas prontas” — botões fora do card | Grid SMS/E-mail + botão WhatsApp full-width (`--ready-stack`) |
| 3 | Header grande / assimétrico | Classe `panel-header--operational` (72px, avatar 34px, Memed oculto, perfil alinhado) |
| 4 | Rodapé vermelho `commit unknown` | Removido do `StagingBuildMarker`; CSS `.staging-audit-footer { display: none }` |
| 5 | Densidade (5–6 cards) | Cards por coluna: queue 86px, review 100px, ready 108px; gaps 6px; support band 52px |
| 6 | Simetria colunas | Colunas `items-stretch`; cards `overflow: hidden`; sem `max-height` global |

## Arquivos alterados

- `mdoctor-panel/src/app/globals.css`
- `mdoctor-panel/src/app/fila/layout.tsx`
- `mdoctor-panel/src/app/fila/page.tsx` (ações review/ready + `operational` no header)
- `mdoctor-panel/src/components/medical/MedicalPanelHeader.tsx`
- `mdoctor-panel/src/components/staging/StagingBuildMarker.tsx`
- `mdoctor-panel/scripts/capture-painel-visual-urgente.js` (captura + auditoria)

## Build e deploy

- `npm run build` — OK
- `railway up --detach -m "fix: visual fila cards header e remover rodape debug"` — serviço **Online**

## Validação visual automatizada

A captura Playwright (`node scripts/capture-painel-visual-urgente.js`) exige `MEDICO_PASS` do **Railway backend staging** (não é `admin123` do `.env.local` local — login staging retorna 401 com essa senha em 2026-06-03).

Com credencial correta:

```powershell
cd mdoctor-panel
$env:MEDICO_PASS='<senha-railway-backend>'
$env:PANEL_URL='https://painel-medico-staging-staging.up.railway.app'
node scripts/capture-painel-visual-urgente.js
```

Gera:

- `docs/SCREENSHOTS-FINAIS/painel-visual-urgente-depois-1366.png`
- `docs/SCREENSHOTS-FINAIS/painel-visual-urgente-depois-1280.png`
- `docs/SCREENSHOTS-FINAIS/painel-visual-urgente-antes-depois.png` (vs `painel-medico-visualsim-atual-validacao.png`)
- `docs/SCREENSHOTS-FINAIS/PAINEL-VISUAL-URGENTE-VALIDACAO.json`

## Checklist manual (1366×768 e 1280×720)

Após login com `drmax.matos`:

1. `/fila?visualSim=1` — 10 pacientes simulados
2. Coluna **EM ATENDIMENTO**: texto acima, botões abaixo, sem sobreposição
3. **RECEITAS PRONTAS**: SMS, E-mail e WhatsApp dentro do card
4. Header: Dr. Max / Administrador compacto, Sair alinhado
5. Sem rodapé vermelho de debug na base da tela
6. ~5–6 cards visíveis por coluna antes do scroll interno

## Confirmações de implementação (código)

- **Texto sobreposto:** removido `height/max-height: 88px` único; hierarquia head → meta → actions
- **Rodapé debug:** componente não renderiza footer; `padding-bottom: 0` no body
- **Botões no card:** stacks full-width com `overflow: hidden` no `.dp-patient-card`
