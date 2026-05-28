# Visao unificada - Mdoctor Survive / Doctor Prescreve

Este documento junta a visao original do produto, o Spec V1 do Master Panel, o estado real do repositorio e as exigencias atuais de qualidade visual, velocidade, seguranca e operacao.

Documento executivo do painel recomendado: `docs/PAINEL-MAIS-INDICADO-SPEC-V1.md`.

## Produto

Doctor Prescreve e uma plataforma de telemedicina assincrona para renovacao segura de receitas de uso continuo, iniciando por quatro patologias elegiveis:

- hipertensao arterial sistemica;
- diabetes tipo 2;
- hipotireoidismo;
- dislipidemia.

O produto deve funcionar como um fluxo operacional medico rapido:

1. Paciente entra por WhatsApp, chatbot ou formulario.
2. Sistema coleta dados clinicos.
3. Motor de elegibilidade faz triagem inicial.
4. Caso elegivel entra em fila medica.
5. Medico revisa o prontuario no painel.
6. Medico aprova ou reprova.
7. Caso aprovado abre fluxo Memed.
8. Receita e gerada, validada e salva.
9. Receita e enviada por WhatsApp, e-mail ou SMS.
10. Auditoria e historico ficam registrados.

## Arquitetura real do repositorio

O projeto atual ja esta separado em tres blocos principais:

- `mdoctor-backend`: backend Express com regras clinicas, fila, JWT, Memed, entrega, logs, readiness, Supabase e APIs.
- `mdoctor-panel`: painel medico em Next.js, React, TypeScript e Tailwind.
- `mdoctor-automation`: camada de automacao/webhooks, encaminhamento para backend, metricas e validacao por segredo.

Essa estrutura esta alinhada com a ideia de produto modular e escalavel.

## Estado funcional atual

Ja existe base funcional para:

- login medico/admin via JWT;
- rotas protegidas;
- fila de atendimentos;
- triagem automatica;
- prontuario medico;
- aprovacao e reprovacao;
- integracao Memed embedded;
- captura de receita Memed;
- validacao final da receita;
- entrega por WhatsApp/SMS/e-mail quando provider real estiver configurado;
- painel master/admin com readiness, metricas e auditoria;
- Supabase preparado por scripts SQL e stores;
- Railway/Docker/envs de producao.

## Spec V1 do Master Panel

O PDF `Doctor Prescreve Master Panel Spec V1` define principalmente o padrao inicial do painel medico:

- interface desktop-first;
- baixo esforco cognitivo;
- fluxo medico rapido;
- minimo de cliques;
- colunas operacionais;
- visual healthtech premium;
- foco em prescricao;
- LGPD como sinal visual;
- Memed como parte central do fluxo.

Telas previstas:

- login em duas colunas;
- dashboard principal com header, divisor dourado, tres colunas e footer;
- coluna `FILA DE ESPERA`;
- coluna `EM ATENDIMENTO`;
- coluna `RECEITAS PRONTAS`;
- prontuario medico;
- tela Memed embedded;
- feedback de entrega;
- estados de auditoria e seguranca.

## Comparacao com o painel atual

O painel atual esta parcialmente alinhado:

- `/fila` ja possui tres colunas, header, divisor dourado, cards, botoes e footer.
- `/atendimento/[id]` ja possui prontuario, dados do paciente, historia clinica, notas, aprovar/reprovar e Memed.
- `/receita` ja possui Memed embedded com dimensoes minimas proximas ao spec.
- `/admin` ja cobre parte do painel master, readiness, integracoes, metricas e auditoria.
- `/login` existe, mas ainda nao segue o spec de duas colunas com identidade premium.
- `/` ainda esta com aparencia provisoria e deve deixar de parecer tela de teste.

## Gap visual principal

O projeto ainda nao esta no nivel visual premium esperado. O problema nao e apenas uma tela especifica; e falta de uma camada visual compartilhada.

Faltam:

- design system real;
- componentes padronizados;
- shell/layout compartilhado;
- botoes consistentes;
- cards consistentes;
- inputs consistentes;
- badges/status pills consistentes;
- tabela padronizada;
- estados loading/empty/error refinados;
- responsividade revisada;
- identidade visual mais forte;
- acabamento de login e home;
- reducao de estilos repetidos diretamente nas paginas.

## Padrao visual obrigatorio

O produto deve parecer:

- plataforma medica moderna;
- healthtech premium;
- software medico operacional;
- limpo, rapido e confiavel;
- elegante sem ser chamativo;
- profissional sem parecer ERP hospitalar antigo.

Evitar:

- visual generico;
- painel improvisado;
- excesso de caixa alta;
- botoes sem padrao;
- cards soltos;
- cores sem hierarquia;
- modais agressivos;
- animacoes exageradas;
- dashboards financeiros/graficos desnecessarios;
- estetica neon/futurista.

## Design tokens do Spec V1

Base atual a manter e organizar:

- `primaryBlue`: `#1557FF`
- `lightBlue`: `#EEF4FF`
- `gold`: `#F4B000`
- `green`: `#0BA84F`
- `danger`: `#FF2D2D`
- `background`: `#F8FAFC`
- `white`: `#FFFFFF`
- `textPrimary`: `#1E1E1E`
- `textSecondary`: `#5B6475`
- `border`: `#E5EAF2`
- `softPink`: `#FADADA`

Raios e sombras devem ser padronizados, nao repetidos manualmente em cada pagina.

## Seguranca e producao

Ja existe boa base de seguranca, mas ainda ha validacoes obrigatorias:

- JWT forte;
- sessao persistente e protegida;
- logout seguro;
- route protection;
- RLS no Supabase;
- HTTPS em producao;
- audit logs;
- CORS restrito;
- rate limit;
- Helmet;
- sem fallback local em producao;
- provider real de entrega;
- Memed real testada com prescritor valido.

Nao declarar como pronto sem confirmacao:

- Stripe;
- AES-256-CBC aplicado aos dados sensiveis;
- N8N completo em producao;
- PDF Memed real enviado automaticamente;
- Supabase/RLS validado em ambiente real.

## Prioridade de execucao

1. Criar base visual compartilhada no painel:
   - `AppShell`
   - `PageHeader`
   - `Button`
   - `Card`
   - `Input`
   - `Select`
   - `StatusPill`
   - `MetricCard`
   - `Toast`
   - `EmptyState`

2. Aplicar primeiro nas telas criticas:
   - `/login`
   - `/fila`
   - `/atendimento/[id]`
   - `/receita`
   - `/admin`

3. Remover aparencia provisoria:
   - substituir `/` por redirecionamento ou tela operacional coerente;
   - remover emoji/status de localhost;
   - padronizar textos e hierarquia.

4. Validar fluxo ponta a ponta:
   - triagem;
   - fila;
   - atendimento;
   - Memed;
   - validacao;
   - entrega;
   - auditoria.

5. Validar producao real:
   - Supabase;
   - Memed;
   - delivery provider;
   - Railway;
   - dominios;
   - SSL;
   - readiness.

## Conclusao

O projeto esta bem alinhado funcionalmente com a ideia original e com boa parte do Spec V1. O maior desvio atual esta no acabamento visual e na falta de um design system consistente. O caminho correto e consolidar a interface agora, antes que novas telas aumentem o custo de refatoracao.
