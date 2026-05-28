# Checklist rapido - Mdoctor Survive

Este checklist resume o estado real do projeto e as correcoes prioritarias para deixar a narrativa alinhada ao codigo atual.

Documento unificado: `docs/VISAO-UNIFICADA-MDOCTOR-SURVIVE.md`.

Painel recomendado segundo a Spec V1: `docs/PAINEL-MAIS-INDICADO-SPEC-V1.md`.

## Estado atual validado

- Backend separado em `mdoctor-backend`, com Express, JWT, Helmet, CORS, rate limit, readiness e rotas modulares.
- Painel separado em `mdoctor-panel`, ja usando Next.js, React e Tailwind.
- Automation separado em `mdoctor-automation`, com webhooks, segredo, metricas e encaminhamento para o backend.
- Triagem clinica ativa para hipertensao, diabetes tipo 2, dislipidemia e hipotireoidismo.
- Fluxo de fila, revisao medica, Memed, validacao, entrega e auditoria ja estruturado.
- Supabase preparado com scripts SQL, stores e check de producao.
- Entrega por WhatsApp/SMS/e-mail existe, dependendo de provider real configurado.
- Memed embedded e persistencia de metadados de receita ja estao previstos no fluxo.

## Ajustes de texto aplicados

- Tratar o projeto como MVP avancado e operacional, nao como produto 100% finalizado.
- Manter Stripe como item de escopo pendente, ate existir checkout/webhook/idempotencia no codigo atual.
- Nao declarar AES-256-CBC como pronto sem implementacao confirmada no repositorio.
- Descrever o N8N/automation como orquestrador de webhooks e integracoes, nao como cerebro completo ja fechado.
- Trocar promessas absolutas de producao por validacoes objetivas: `/readyz`, Supabase, Memed real e provider de entrega.

## Prioridade imediata

1. Criar design system compartilhado no painel antes de novas telas.
2. Refatorar `/login`, `/fila`, `/atendimento/[id]`, `/receita` e `/admin` para o mesmo padrao visual.
3. Remover aparencia provisoria da home `/`.
4. Rodar `npm run pre-github-check` na raiz.
5. Rodar `cd mdoctor-backend && npm run production-check`.
6. Aplicar/validar schema Supabase em producao.
7. Configurar credenciais reais Memed.
8. Configurar provider real de entrega: Twilio WhatsApp/SMS ou Resend.
9. Testar fluxo ponta a ponta: WhatsApp/API, fila, medico, Memed, validacao, entrega e auditoria.
10. Decidir se Stripe continua no SPEC V1 ou fica para fase seguinte.

## Itens que ainda faltam para 100%

- Design system real no painel.
- Consolidar `AppShell`, `AlertBanner`, `EmptyState` e `FieldRow` nas telas criticas.
- Login conforme Spec V1 em duas colunas com identidade premium.
- Consistencia visual entre fila, prontuario, receita, admin e home.
- Dominios publicos, SSL e variaveis reais no Railway.
- RLS validado em producao.
- Teste com prescritor Memed real.
- Captura final de PDF/URL/protocolo em caso real.
- Sessao com expiracao/renovacao/logout mais completos.
- Observabilidade, backup e restore testados.
- Pagamento Stripe, se permanecer no escopo.

## Conclusao curta

O projeto esta muito alinhado com a ideia original: telemedicina assincrona com triagem, fila medica, painel, Memed, automacao e entrega. A descricao correta hoje e: MVP avancado, modular, rapido de operar e com boa base de seguranca, ainda pendente de validacao real de producao e de alguns itens de escopo.
