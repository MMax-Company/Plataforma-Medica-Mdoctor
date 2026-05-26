# Deploy Producao - Plataforma Medica MDoctor

## Ordem recomendada

1. Aplicar o schema no Supabase:
   - banco novo: `docs/supabase-atendimentos.sql`
   - banco ja existente/legado: `docs/supabase-upgrade-production.sql`
2. Rodar `cd mdoctor-backend && npm run production-check`.
3. Criar os servicos no Railway apontando para:
   - `mdoctor-backend`
   - `mdoctor-panel`
   - `mdoctor-automation`
4. Configurar variaveis usando:
   - `mdoctor-backend/.env.production.example`
   - `mdoctor-panel/.env.production.example`
   - `mdoctor-automation/.env.production.example`
5. Subir backend e confirmar `/health` e `/readyz`.
6. Subir painel e confirmar `/login`.
7. Subir automation e confirmar `/healthz`.
8. Entrar em `/admin` e resolver qualquer item pendente do readiness.
9. Validar fluxo vivo: triagem, fila, Memed, receita, entrega e auditoria.

## Variáveis que bloqueiam produção

- `NODE_ENV=production`
- `JWT_SECRET` forte, com pelo menos 32 caracteres.
- `MEDICO_PASS` diferente de `admin123`.
- `CORS_ORIGIN` com o domínio real do painel, sem `*`.
- Supabase service key.
- Memed production credentials.
- Pelo menos um provider real de entrega:
  - Twilio WhatsApp/SMS, ou
  - Resend e-mail.

## Health checks

- Backend: `/health`
- Backend readiness: `/readyz`
- Painel: `/login`
- Automation: `/healthz`

## Rotas operacionais

- `/login`
- `/fila`
- `/atendimento/[id]`
- `/receita?atendimentoId=...`
- `/admin`
