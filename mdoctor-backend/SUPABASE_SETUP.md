# Supabase Setup - Mdoctor Backend MVP

## Ordem de aplicacao

1. Criar um projeto Supabase de staging ou producao.
2. Aplicar a migration:

```bash
supabase db push
```

Ou copiar o SQL de `supabase/migrations/20260527_backend_mvp_storage.sql` para o SQL Editor do Supabase.

3. Criar/confirmar os buckets privados:

```text
documents
prescriptions
medical-records
consents
logs
```

Para Railway staging real, aplicar a migration antes de desligar o fallback local. Para smoke test tecnico sem banco real, as variaveis Supabase podem ficar vazias e o backend continua em `fallback_local`.

4. Configurar variaveis somente no backend:

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_BUCKET_DOCUMENTS=documents
SUPABASE_BUCKET_PRESCRIPTIONS=prescriptions
SUPABASE_BUCKET_RECEITAS_ANTERIORES=receitas-anteriores
SUPABASE_BUCKET_MEDICAL_RECORDS=medical-records
SUPABASE_BUCKET_CONSENTS=consents
SUPABASE_BUCKET_LOGS=logs
```

## Tabelas criadas

- `patients`
- `atendimentos`
- `prescriptions`
- `audit_logs`

## RLS e seguranca

RLS fica habilitado em todas as tabelas. As policies permitem acesso para `service_role`, que deve ser usado apenas pelo backend.

Nunca exponha `SUPABASE_SERVICE_ROLE_KEY` no frontend, em variaveis `NEXT_PUBLIC_*`, logs, screenshots ou repositorio.

No Railway, configurar `SUPABASE_SERVICE_ROLE_KEY` somente no servico `Backend-MDoctor-Staging` ou no backend de producao. O servico `Painel-MDoctor-Staging` nao deve receber service role.

## Fallback local

Se Supabase nao estiver configurado ou falhar em ambiente local/staging com fallback permitido, o backend continua usando store local/mock para nao quebrar o painel MVP.

O endpoint `GET /readyz` informa:

```text
storage.mode
supabase.configured
supabase.connected
fallback_local
```

Em producao, use:

```env
DISABLE_LOCAL_DB_FALLBACK=true
```

Assim falhas de persistencia real nao sao mascaradas.
