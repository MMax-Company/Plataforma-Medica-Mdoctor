# Backups n8n — produção

JSON exportados da Public API n8n (**sem secrets**). Credenciais nos nós ficam só com `id`/`name`.

## Gerar backup

```bash
# N8N_API_KEY no ambiente (Railway)
node scripts/backup-n8n-workflows-production.js
```

Arquivos: `YYYY-MM-DD-evolution-webhook-production.json`, `YYYY-MM-DD-typebot-webhook-production.json`, `YYYY-MM-DD-manifest.json`.

## Restore

Ver `docs/RUNBOOK-WHATSAPP-PRODUCAO.md` → seção **Restore workflow**.

Não commitar arquivos com tokens embutidos em Code nodes — revisar diff antes do push.
