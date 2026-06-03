# Validação fluxo produto + limpeza legado

**Data:** 2026-06-03  
**Script:** `scripts/validar-fluxo-produto.js`  
**Build painel:** `npm run build` (Next 14) — OK

## Fluxo validado (API + painel)

| Etapa | Status |
|--------|--------|
| Triagem n8n → `atendimentoId` | OK |
| Login médico | OK |
| Fila contém atendimento | OK |
| API atendimento (prontuário) | OK |
| Salvar conduta clínica | OK |
| Aprovar clínico (elegível) | OK |
| Memed token (`sinapse_production`) | OK |
| Páginas `/login`, `/fila`, `/atendimento`, redirects legado | OK |

## Legado removido (painel)

- Pasta `components/dashboard/*` (kanban antigo)
- Páginas dev: `/test`, `/test-integration`, `/test-eligibility`, `/whatsapp`
- Componentes mortos: `PatientCard`, `DecisionActions`, `MedicalHistoryCard`, `MedicalNotes`, `AttachedPrescriptionCard`
- Memed mock: `MemedProcessingHeader`, `MemedStatusPanel`, `PrescriptionActions`, `PrescriptionPreview`
- `useDashboardStore`, `lib/api.ts`, `hooks/useEligibility.ts`, `eligibility.service.ts`
- Bloco `if (false)` em `fila/page.tsx`

## Rotas legado → canônicas

| Antiga | Nova |
|--------|------|
| `/prontuario/[id]` | redirect → `/atendimento/[id]` |
| `/memed/[id]` | redirect → `/receita?atendimentoId=` |
| `/dashboard` | redirect → `/fila` (mantido para probes) |

## Memed

- **Token:** OK em staging (`/api/memed/token`)
- **Emissão real:** requer ação humana no widget Sinapse em `/receita` (sem mock)
- **Callback/PDF:** depende de conclusão no Memed — não automatizado neste script

## Pendências reais (manual)

1. Mensagem WhatsApp física + Typebot no browser
2. QR Evolution se `check-production-health` falhar em `evolution_instance_open`
3. Assinatura Memed e entrega WhatsApp real (sandbox/dry-run pode estar ativo no backend)

## Comandos

```bash
node scripts/check-production-health.js
node scripts/validar-fluxo-produto.js
cd mdoctor-panel && npm run build
```
