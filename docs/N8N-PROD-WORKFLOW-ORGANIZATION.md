# Organização workflows n8n produção — Doctor Prescreve

**Data:** 2026-05-29  
**Serviço:** `n8n Node` (`Automation-MDoctor` / production)  
**URL:** https://n8n-node-production-f844.up.railway.app

---

## 1. Confirmações (antes da mudança)

| Item | Resultado |
| --- | --- |
| Workflow ativo Typebot produção | **`My workflow 7`** (ID `P7qhHC4iNgW8sxDJ`), `active: true` |
| Único workflow com `active: true` entre 17 workflows | Sim |
| Path no node Typebot (antes) | `webhook/typebot-webhook` → URL efetiva **`/webhook/webhook/typebot-webhook`** |
| Path esperado pelo Typebot (export) | **`/webhook/typebot-webhook`** |
| Path `/webhook/typebot-webhook` registrado (antes) | **Não** (404) — Typebot apontava para URL que não batia com o node |

---

## 2. Ações executadas

1. Inventário read-only via Postgres do `Postgres Node` (sem alterar Postgres/volumes/variáveis).
2. Renomear workflow oficial: **`Doctor Prescreve — Typebot Produção`**.
3. Padronizar paths dos webhooks no workflow oficial:
   - Typebot: `typebot-webhook` → `/webhook/typebot-webhook`
   - Z-API: `zapi-webhook` → `/webhook/zapi-webhook`
4. Remover **16** workflows inativos/legado/teste (somente registros n8n no banco).
5. Sincronizar `workflow_history` com os nodes atualizados (n8n 2.x usa histórico na ativação).
6. **`railway restart`** do `n8n Node` (sem rebuild, sem tocar Postgres).

Scripts usados (repositório):

- `mdoctor-backend/scripts/n8n-prod-workflow-audit.js`
- `mdoctor-backend/scripts/n8n-prod-workflow-organize.js` (`--apply`)
- `mdoctor-backend/scripts/n8n-prod-sync-history.js`

---

## 3. Workflow oficial final

| Campo | Valor |
| --- | --- |
| **Nome** | `Doctor Prescreve — Typebot Produção` |
| **ID** | `P7qhHC4iNgW8sxDJ` |
| **Status** | Ativo |
| **Webhook Typebot** | `POST https://n8n-node-production-f844.up.railway.app/webhook/typebot-webhook` |
| **Webhook Z-API (WhatsApp prod)** | `POST https://n8n-node-production-f844.up.railway.app/webhook/zapi-webhook` |

### Teste pós-renomear (HTTP)

| URL | Status |
| --- | --- |
| `/webhook/typebot-webhook` | **200** |
| `/webhook/zapi-webhook` | **200** |
| `/webhook/webhook/typebot-webhook` (legado) | **500** — path antigo não deve mais ser usado |

---

## 4. Workflows removidos (16)

Todos estavam **`active: false`**, sem tráfego no fluxo atual.

| Nome |
| --- |
| Automacao Doctor Prescreve |
| Doctor Prescreve - Supabasecopy |
| Doctor Prescreve - Supabase (CORRIGIDO) ×2 |
| Doctor Prescreve - Supabase (CORRIGIDO) copy |
| Doctor Prescreve - TESTE |
| My workflow |
| My workflow 2 ×2 |
| My workflow 3 ×2 |
| My workflow 3 - MODO TESTE (SEM WHATSAPP) |
| My workflow 4 |
| My workflow 5 |
| My workflow 6 |
| WhatsApp → Typebot → Backend Flow |

**Equivalentes aos nomes citados:**

- *Doctorprescreve - supabase* → variantes **Supabase (CORRIGIDO)** / **Supabasecopy**
- *doctor prescreve teste* → **Doctor Prescreve - TESTE**

---

## 5. Workflows mantidos

| Ambiente | Onde |
| --- | --- |
| **Produção oficial** | 1 workflow: `Doctor Prescreve — Typebot Produção` |
| **Staging** | Intocados (`n8n-staging` — projeto/ambiente separado) |

---

## 6. Riscos encontrados

| Risco | Severidade | Detalhe |
| --- | --- | --- |
| **URL Typebot vs path n8n** | Alta (mitigada) | Antes o Typebot usava `/webhook/typebot-webhook` mas o node tinha path `webhook/typebot-webhook`. Agora alinhado. |
| **Z-API pode usar URL antiga** | Média | Se Z-API estava em `/webhook/webhook/zapi-webhook`, atualizar para `/webhook/zapi-webhook`. |
| **Edição direta no Postgres** | Média | Mudanças via SQL + restart; ideal futuro: API n8n com `N8N_API_KEY` para publish/activate. |
| **`workflow_history` dessincronizado** | Alta (corrigida) | Só atualizar `workflow_entity` não bastou; foi necessário sync em `workflow_history`. |
| **Licença n8n expirada** | Baixa | Logs `[license SDK] cert is invalid` — não bloqueou operação. |
| **Sem export Git do workflow prod** | Média | Workflow prod ainda não versionado em `docs/n8n-workflows/production/` — recomendado exportar via UI/API. |

---

## 7. O que não foi alterado

- Postgres Node, volumes, variáveis Railway  
- Backend, painel, Typebot cloud  
- Workflows staging (`n8n-staging`)  
- Evolution staging  

---

## 8. Próximos passos recomendados

1. Confirmar no **Typebot cloud** que o webhook continua `…/webhook/typebot-webhook` (agora válido).
2. Confirmar no **Z-API** a URL `…/webhook/zapi-webhook` se integração WhatsApp prod estiver ativa.
3. Exportar o workflow oficial para `docs/n8n-workflows/production/doctor-prescreve-typebot-production.json`.
4. Criar `N8N_API_KEY` no n8n prod para futuras mudanças sem SQL direto.
