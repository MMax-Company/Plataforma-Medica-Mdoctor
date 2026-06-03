# Memed staging — UX profissional (Doctor Prescreve)

Integração real **sem mock**, **sem PDF fake**, **sem assinatura automatizada**. Staging only (`mdoctor-backend-staging` + `painel-medico-staging`).

## Fluxo clínico

1. Login painel → fila → atendimento → **Emitir Receita**
2. `/receita?atendimentoId=...` — token fresco (`GET /api/memed/token?refresh=1`)
3. Script Sinapse **único** (`data-container`, `data-color` #1557FF)
4. `core:moduleInit` → `setPaciente` → `addItem` → `setFeatureToggle`
5. MdHub `show` — médico emite e assina (BirdID/Soluti)
6. `prescricaoImpressa` → `POST /api/memed/receita` (PDF, link digital, unlock_code)
7. Validação clínica → entrega WhatsApp

## Comandos MdHub aplicados

| Comando | Quando |
|---------|--------|
| `setPaciente` | Antes de `show` (async) |
| `addItem` | Após paciente, por medicação da triagem |
| `setFeatureToggle` | Após `moduleInit` |
| `show` / `hide` | Abrir/fechar sem logout |
| `prescricaoImpressa` | Persistência backend |
| `prescricaoExcluida` | `POST /api/memed/receita/cancelada` |

## Feature toggles

- `setAllowedSignatureProviders: ['soluti']`
- Onboarding/ajuda/histórico/compartilhamento desligados
- `forceSign: true` (assinatura no widget, não no painel)

## Script por ambiente

| Ambiente | URL |
|----------|-----|
| **Padrão staging (embedded)** | `integrations.../sinapse-prescricao.min.js` |
| Partners (legado) | `partners.memed.com.br/integration.js` — só com `MEMED_WIDGET_SCRIPT=partners` |

Override: `MEMED_SCRIPT_URL` no Railway staging.

**Causa comum da tela de múltiplos certificados:** uso de `integration.js` (partners) em vez do Sinapse embedded. O backend staging agora defaulta Sinapse.

## Arquitetura (manual, estilo memed-react)

- `memedRuntime.ts` — script único global, sem logout entre receitas
- `prepareAndShowPrescription` — setPaciente → addItem → toggles → show
- **Não** migramos `MemedProvider`/`useMemed` (mesmo lifecycle, menos risco)

## Sessão BirdID

- **Não** chamar `logout` ao trocar atendimento (apenas `hide`)
- Atualizar `data-token` sem remover `<script>`
- Token prescritor: refresh antes de cada abertura do widget

## Credenciais prescritor

Prioridade absoluta: `MEMED_PRESCRITOR_EXTERNAL_ID` (não `MEDICO_EXTERNAL_ID` divergente).
