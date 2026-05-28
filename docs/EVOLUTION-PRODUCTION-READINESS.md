# Evolution API — Production Readiness (Doctor Prescreve)

Data/hora: 2026-05-28 -03:00

## Objetivo

Documentar o caminho seguro para uso futuro da Evolution API (ou migracao para WhatsApp Cloud API oficial) em producao, **sem ativar producao nesta etapa**.

## Estado atual (staging)

| Item | Status |
| --- | --- |
| Runtime Evolution dedicado | `evolution-api-staging` (Automation-MDoctor / staging) |
| Imagem | `evoapicloud/evolution-api:latest` |
| Porta | `8080` |
| Instancia WhatsApp | `mdoctor-staging` |
| Backend staging | `EVOLUTION_*` configurado via Railway (sem secrets no repo) |
| Modo seguro | `WHATSAPP_SANDBOX_MODE=true`, `WHATSAPP_DRY_RUN=true` |
| Producao Railway | Intocada |

## Envs necessarias para producao (quando autorizado)

Backend producao (servico dedicado, nunca reutilizar staging):

- `WHATSAPP_PROVIDER=evolution`
- `EVOLUTION_API_URL=<url evolution producao>`
- `EVOLUTION_API_KEY=<AUTHENTICATION_API_KEY producao>`
- `EVOLUTION_INSTANCE=<nome instancia producao>`
- `EVOLUTION_TIMEOUT_MS=12000`
- `WHATSAPP_SANDBOX_MODE=false` (apos validacao)
- `WHATSAPP_DRY_RUN=false` (apos validacao controlada)
- `DELIVERY_MOCK_ENABLED=false` (producao real)
- `ALLOW_PRODUCTION_DELIVERY_MOCK=false`

Runtime Evolution producao (servico separado):

- `AUTHENTICATION_API_KEY=<secret forte>`
- `SERVER_PORT=8080`
- `SERVER_URL=<url publica evolution producao>`
- `DATABASE_PROVIDER=postgresql`
- `DATABASE_CONNECTION_URI=<postgres producao>`
- `CACHE_REDIS_ENABLED=true`
- `CACHE_REDIS_URI=<redis producao>`

## Auditoria Docker staging (2026-05-28)

Achados do runtime `evolution-api-staging` (read-only):

| Topico | Staging | Recomendacao producao |
| --- | --- | --- |
| Imagem | `evoapicloud/evolution-api:latest` | Mesma linha, tag fixada (nao apenas `latest`) |
| Postgres + Redis | Com volume persistente | Servicos dedicados isolados |
| Volume `/evolution/instances` na API | **Ausente** | **Obrigatorio** montar volume no servico Evolution |
| Replicas | 1 | Manter 1 replica por instancia Baileys |
| Worker/fila extra | Nao necessario | Nao obrigatorio para MVP de envio |
| Sessao WhatsApp | Instancia no DB, estado `close` ate QR | QR controlado + validar `open` antes de trafego real |
| Imagem Docker | `evoapicloud/evolution-api:latest` (staging ja correto) | Fixar digest/tag em producao; nao usar `atendai/evolution-api` |

Auditoria 2026-05-28: local e Railway staging confirmados em `evoapicloud/evolution-api:latest` (digest `sha256:966625532d90…`). Imagem legada `atendai/evolution-api` nao encontrada localmente; Railway nao precisou de troca.

Detalhes: `docs/EVOLUTION-API-STAGING.md` (secoes Auditoria Docker / Runtime Railway e Auditoria de imagem Docker).

## Riscos

- Deploy Evolution sem volume de sessao pode exigir novo QR apos restart (mesmo com Postgres).
- Uso de numero pessoal/principal em ambiente de teste pode gerar bloqueio ou mistura de trafego.
- Evolution Web (Baileys) depende da versao web do WhatsApp; pode quebrar sem aviso.
- Envio em massa sem controles pode causar banimento do numero.
- Credencial global (`AUTHENTICATION_API_KEY`) comprometida expoe todas as instancias.
- Instancia em `open` sem monitoramento pode enviar mensagens reais inadvertidamente se dry-run for desligado cedo.

## Rollback

1. Reativar imediatamente no backend:
   - `WHATSAPP_DRY_RUN=true`
   - `WHATSAPP_SANDBOX_MODE=true`
   - ou `WHATSAPP_PROVIDER=mock`
2. Redeploy apenas do backend afetado.
3. Validar `GET /api/whatsapp/provider-status` (`mode=mock` ou `dryRun=true`).
4. Se necessario, desconectar instancia Evolution via manager (operacao manual controlada).
5. Manter fallback mock ativo ate estabilizacao.

## Checklist antes de producao

- [ ] Runtime Evolution producao isolado (projeto/ambiente/servico separados de staging).
- [ ] Postgres + Redis dedicados em producao.
- [ ] `AUTHENTICATION_API_KEY` forte gerada e armazenada somente no Railway producao.
- [ ] Instancia producao com nome explicito (ex.: `mdoctor-production`).
- [ ] Numero WhatsApp Business ou linha dedicada (nao numero pessoal).
- [ ] QR/pairing feito em janela controlada; `connectionState=open` validado.
- [ ] `provider-status` com `configured=true`, `apiReachable=true`, `instanceFound=true`.
- [ ] Teste dry-run em staging reproduzido em pre-producao.
- [ ] 1 mensagem real para numero autorizado de teste, com audit log.
- [ ] Rate limit webhook e anti-spam sandbox revisados para producao.
- [ ] Fallback mock testado em falha de provider.
- [ ] Plano de migracao para WhatsApp Cloud API oficial revisado com Meta.
- [ ] LGPD/consentimento do paciente alinhados ao canal WhatsApp.
- [ ] Volume persistente `/evolution/instances` no servico Evolution producao.
- [ ] `DATABASE_SAVE_DATA_INSTANCE=true` e demais flags de persistencia revisadas explicitamente.
- [ ] Tag de imagem Docker fixada (evitar `latest` mutavel em producao).

## Recomendacoes operacionais

- Nao usar numero pessoal do medico ou da operacao.
- Preferir numero de teste em staging e numero dedicado de atendimento em producao.
- Manter `WHATSAPP_DRY_RUN=true` ate checklist completo em ambiente espelho.
- Registrar toda ativacao/desativacao em `docs/RAILWAY-STAGING-RESULTADO.md` (staging) ou runbook de producao.

## Estrategia futura: WhatsApp Cloud API oficial

Quando a Cloud API for liberada pela Meta:

1. Introduzir provider `cloud-api` paralelo ao `evolution` (sem remover fallback).
2. Migrar envio gradual por feature flag (`WHATSAPP_PROVIDER=cloud-api`).
3. Manter Evolution em staging como ambiente de regressao ate paridade de testes.
4. Descomissionar Evolution em producao somente apos:
   - webhooks Meta validados
   - templates HSM aprovados
   - auditoria e entrega estaveis no painel

Referencias:

- [evolution-foundation/evolution-api](https://github.com/evolution-foundation/evolution-api)
- [docs.evolutionfoundation.com.br](https://docs.evolutionfoundation.com.br)
