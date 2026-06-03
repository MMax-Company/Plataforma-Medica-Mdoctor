# Integração Memed/Sinapse — alinhamento memed-react

Referência: [devisales/memed-react](https://github.com/devisales/memed-react)

## Fluxo oficial (único)

```text
painel (/receita)
  → widget Memed/Sinapse (médico prescreve e assina na Memed)
  → callback prescricaoImpressa
  → POST /api/memed/receita
  → persistência (atendimento + audit)
```

Doctor Prescreve **não**:

- emite receita sozinho (sem widget);
- assina digitalmente;
- manipula certificado digital;
- usa `POST /api/prescriptions` como fluxo oficial.

## Responsabilidades

| Etapa | Quem |
|-------|------|
| Token prescritor | Backend `GET /api/memed/token` |
| Script Sinapse + MdHub | Painel React |
| Prescrição + assinatura (Bird ID) | Widget Memed |
| Persistência pós-confirmação | `POST /api/memed/receita` |
| Validação clínica pós-emissão | `POST /api/atendimentos/:id/clinical/validate` |

## Mapeamento memed-react

| memed-react | Doctor Prescreve |
|-------------|------------------|
| `createMemedScript` | `src/lib/memed/createMemedScript.ts` |
| `onLoadPrescription` | `src/lib/memed/onLoadPrescription.ts` |
| `setMemedPatient` | `src/lib/memed/setMemedPatient.ts` |
| `showPrescription` | Botão explícito em `/receita` |
| `prescricaoImpressa` | `setupPrescriptionCallback` → `saveMemedReceipt` |

## Arquivos

- `mdoctor-panel/src/app/receita/page.tsx`
- `mdoctor-panel/src/hooks/useMemedSinapse.ts`
- `mdoctor-panel/src/lib/memed/*`
- `mdoctor-backend/src/routes/memed.routes.js`

## Endpoints legados (não oficiais)

`POST /api/prescriptions` e `POST /api/prescriptions/:id/generate` respondem **410** com orientação ao fluxo widget.

Ver também: `docs/FLUXO-RECEITA-OFICIAL.md`
