# Typebot Staging Funcional Checklist

Data/hora: 2026-05-28 09:03 -03:00

## Objetivo

Checklist de prontidao funcional do export Typebot staging-safe antes de testes reais.

## Fluxo e Seguranca

- [x] Fluxo clinico preservado
- [x] Webhook de producao removido do staging-safe
- [x] Webhook staging configurado:
  - `https://n8n-staging-staging-2dfe.up.railway.app/webhook/typebot-webhook`
- [x] Bloco de pagamento preservado sem alteracao estrutural
- [x] Nenhum secret novo hardcoded no JSON staging-safe

## Data de Nascimento

- [x] Campo orientado para `dd/mm/aaaa`
- [x] Placeholder com exemplo claro
- [x] Mensagem de retry para formato invalido
- [x] Regra documentada de normalizacao para `yyyy-mm-dd` no n8n
- [x] Regra documentada para nao enviar data vazia/invalida

## LGPD e Textos

- [x] Texto de consentimento LGPD revisado
- [x] Texto de confirmacao de dados revisado
- [x] Texto de elegibilidade revisado
- [x] Texto de sinais de alerta revisado
- [x] Mensagens finais revisadas
- [x] Coleta de CPF mantida com contexto LGPD

## Documentos e Links

- [x] Placeholders definidos para documentos:
  - `SUPABASE_PUBLIC_LGPD_URL`
  - `SUPABASE_PUBLIC_TELEMEDICINA_TERMO_URL`
  - `SUPABASE_PUBLIC_PRIVACIDADE_URL`
  - `SUPABASE_PUBLIC_CONSENTIMENTO_URL`
  - `SUPABASE_PUBLIC_ORIENTACAO_PACIENTE_URL`
- [x] Nenhum webhook de producao ativo no arquivo staging-safe

## Validacao Tecnica

- [x] JSON parseavel
- [x] Estrutura importavel (groups/blocks/edges mantidos)
- [x] Payment block permanece presente com mesmo `credentialsId`

## Pendencias para Go-Live de Teste

- [ ] Preencher placeholders com URLs publicas reais do staging (preferencialmente Supabase bucket publico controlado)
- [ ] Confirmar no Typebot runtime que a credencial de pagamento usada nao aponta para producao (ou desativar rota de pagamento em testes sem confirmacao)
- [ ] Validar n8n normalizando `data_nascimento` para `yyyy-mm-dd` apenas quando formato `dd/mm/aaaa` for valido
