# Producao Real - Checklist Doctor Prescreve

Use este checklist para transformar o beta privado em operacao real.

Resumo honesto do estado atual: o projeto ja tem base operacional forte, mas ainda precisa validar Supabase real, Memed real, provider real de entrega e variaveis de producao antes de ser tratado como 100% pronto.

## 1. Supabase

1. Abrir o SQL Editor do Supabase.
2. Se o banco estiver novo, executar `docs/supabase-atendimentos.sql`.
3. Se o banco ja existir com schema antigo, executar `docs/supabase-upgrade-production.sql`.
4. Confirmar que as tabelas existem:
   - `atendimentos`
   - `decisoes_log`
   - `entregas_receita`
   - `receitas_memed`
   - `medicos`
5. Confirmar RLS ligado e policies `service_role_full_*`.
6. Confirmar que `anon` e `authenticated` nao possuem acesso direto.

Valide localmente:

```bash
cd mdoctor-backend
npm run production-check
```

## 2. Backend

Variaveis obrigatorias no deploy:

- `NODE_ENV=production`
- `DISABLE_LOCAL_DB_FALLBACK=true`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY` ou `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`
- `MEDICO_USER`
- `MEDICO_PASS`
- `CORS_ORIGIN`
- Credenciais Memed reais
- Provider real de entrega: Twilio WhatsApp/SMS ou Resend

Validar:

```bash
curl https://SEU-BACKEND/readyz
```

## 3. Memed

1. Confirmar dominio do painel liberado na Memed.
2. Confirmar `MEMED_ENVIRONMENT=production`.
3. Testar token com login medico.
4. Abrir `/receita?atendimentoId=...`.
5. Confirmar captura:
   - `receitaId`
   - `protocolo`
   - `receitaUrl`
   - `pdfUrl`
   - registro em `receitas_memed`

## 4. Fluxo clinico

Executar ponta a ponta:

1. Criar atendimento via WhatsApp/API.
2. Confirmar `QUEUE`.
3. Medico assumir `UNDER_REVIEW`.
4. Abrir Memed `MEMED_PROCESSING`.
5. Capturar receita `AWAITING_VALIDATION`.
6. Aceitar receita `VALIDATED`.
7. Entregar receita `DELIVERED`.
8. Conferir auditoria no painel master.

## 5. Escopo pendente

Nao marcar como pronto sem validacao no codigo e no ambiente:

- Stripe: checkout, webhook assinado, idempotencia e auditoria de pagamento.
- AES-256-CBC: apenas declarar se a criptografia estiver implementada e usada nos dados sensiveis.
- N8N completo: confirmar fluxos ativos, webhooks publicos e segredos.
- PDF Memed: confirmar captura real de URL/PDF/protocolo com prescritor valido.

## 6. GitHub

Subir codigo e exemplos, nao subir:

- `.env`
- `.env.production`
- `node_modules`
- `.next`
- `whatsapp_auth`
- logs
- `*.log`
