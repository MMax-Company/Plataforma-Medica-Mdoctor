# Painel mais indicado - Spec V1

Este documento define a versao mais indicada, funcional e realista do Painel Doctor Prescreve para o Mdoctor Survive, unindo a Spec V1 com o estado atual do projeto.

## Objetivo

Construir um painel medico premium, rapido e seguro para operacao diaria de telemedicina assincrona. O foco nao e criar muitas telas; e reduzir cliques, organizar o fluxo medico e transmitir confianca visual.

## Estrutura recomendada

### 1. Login medico

Funcao:

- autenticar medico ou admin;
- comunicar seguranca, LGPD e proposta medica;
- levar direto para a fila operacional.

Estado ideal:

- layout em duas colunas;
- identidade Doctor Prescreve visivel;
- formulario limpo;
- erro de login claro;
- sem aparencia de teste.

Status atual: parcialmente alinhado.

### 2. Fila operacional

Funcao:

- ser a tela principal do medico;
- mostrar o fluxo inteiro em colunas;
- permitir atender, revisar e entregar sem navegar demais.

Colunas obrigatorias:

- Fila de espera;
- Em atendimento;
- Receitas prontas;
- Finalizados como bloco secundario.

Controles obrigatorios:

- busca por paciente, telefone, condicao ou status;
- filtro de status;
- filtro de risco;
- filtro de pagamento;
- botao atualizar;
- cards com tempo de espera, condicao, contato e acao principal.

Status atual: bem alinhado e funcional.

### 3. Prontuario medico

Funcao:

- concentrar dados do paciente, triagem, historia clinica, elegibilidade, decisao medica e Memed.

Blocos obrigatorios:

- dados do paciente;
- elegibilidade;
- queixa principal;
- historico clinico;
- exame fisico;
- alergias;
- medicacoes em uso;
- conduta;
- observacoes medicas;
- historico de decisoes;
- receita anexada;
- acao Memed.

Acoes obrigatorias:

- reavaliar elegibilidade;
- editar prontuario;
- reprovar com motivo;
- aprovar e abrir Memed;
- visualizar receita;
- aceitar receita.

Status atual: bem avancado, mas ainda precisa padronizar visual com o shell do painel.

### 4. Prescricao Memed

Funcao:

- abrir a Memed embedded com o paciente ja carregado;
- salvar metadados da receita;
- voltar ao atendimento.

Requisitos:

- area Memed grande e prioritaria;
- lateral com resumo do atendimento;
- status claro da integracao;
- erro claro quando credenciais/dominio/HTTPS estiverem faltando.

Status atual: funcional e alinhado.

### 5. Painel Master

Funcao:

- mostrar saude de producao, integracoes, metricas e auditoria.

Blocos obrigatorios:

- readiness;
- status Supabase;
- status Memed;
- status delivery;
- metricas operacionais;
- auditoria recente;
- alertas prioritarios.

Status atual: alinhado para MVP avancado.

## Padrao visual obrigatorio

O painel deve parecer:

- plataforma medica moderna;
- healthtech premium;
- limpo e objetivo;
- rapido para uso medico;
- seguro e confiavel.

Evitar:

- tela com cara de localhost;
- excesso de cards decorativos;
- botoes diferentes para a mesma funcao;
- caixa alta excessiva;
- informacao clinica espremida;
- home provisoria;
- prometer producao antes de readiness real.

## Componentes base

O painel deve crescer usando componentes compartilhados em `mdoctor-panel/src/components/ui/DesignSystem.tsx`:

- `AppShell`;
- `Button`;
- `Card`;
- `TextInput`;
- `SelectInput`;
- `StatusPill`;
- `AlertBanner`;
- `PageHeader`;
- `MetricCard`;
- `EmptyState`;
- `FieldRow`.

## Prioridade de implementacao

1. Consolidar `AppShell` em `/fila`, `/atendimento/[id]`, `/receita` e `/admin`.
2. Trocar botoes manuais por `Button`.
3. Trocar mensagens soltas por `AlertBanner`.
4. Trocar estados vazios por `EmptyState`.
5. Trocar linhas de dados por `FieldRow`.
6. Revisar responsividade das colunas.
7. Rodar build do painel.
8. Testar fluxo: login, fila, atendimento, Memed e entrega.

## Conclusao

O mais indicado segundo a Spec nao e criar um painel enorme agora. O correto e consolidar o painel medico operacional com tres telas fortes: fila, prontuario e Memed. O Painel Master deve ficar como camada administrativa de producao. Essa combinacao entrega velocidade, seguranca, clareza medica e base visual premium sem transformar o MVP em um sistema pesado.
