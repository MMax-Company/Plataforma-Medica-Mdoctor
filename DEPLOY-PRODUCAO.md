# Deploy Produção - MDoctor Survive

## Blindagem Railway/GitHub

O repositorio oficial para evolucao e `MMax-Company/Plataforma-Medica-Mdoctor`.

O Railway ainda pode conter servicos apontando para `MMax-Company/Mdoctor-Prescreve`, que deve ser tratado como legado de producao ate a migracao ser concluida. Antes de alterar source repo, root directory, variaveis ou start command no Railway, consulte `docs/TRANSICAO-RAILWAY-GITHUB.md`.

Nao migrar todos os servicos de uma vez. A transicao deve ser feita por servico, com health check e logs validados antes do proximo passo.

## Staging antes de producao

Antes de qualquer alteracao em producao, criar e validar os servicos staging descritos em `docs/RAILWAY-STAGING-SETUP.md`:

- `Backend-MDoctor-Staging`, root `mdoctor-backend`, healthcheck `/health`.
- `Painel-MDoctor-Staging`, root `mdoctor-panel`, healthcheck `/login`.

O painel staging deve apontar para o backend staging via `NEXT_PUBLIC_API_URL`. Nao usar dominio oficial, variaveis de producao, Stripe live, Memed production ou WhatsApp real enquanto o staging tecnico nao estiver validado.

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
10. Registrar no checklist rapido se Stripe ficara no SPEC V1 ou em fase posterior.

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

## Itens que nao devem ser prometidos antes do teste real

- Stripe pronto, enquanto checkout e webhook assinado nao estiverem implementados.
- Criptografia AES aplicada aos dados sensiveis, enquanto nao houver implementacao confirmada.
- N8N como orquestrador completo, enquanto os fluxos reais nao estiverem publicados e validados.
- Receita entregue automaticamente por WhatsApp, enquanto Memed e provider de entrega nao forem testados ponta a ponta.

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
