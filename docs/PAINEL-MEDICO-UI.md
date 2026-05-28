# Painel Medico UI - Master Spec V1

Data/hora: 2026-05-28 09:48 -03:00

## Referencias adotadas

Prioridade aplicada nesta entrega:

1. `docs/Master Panel Spec V1/Doctor Prescreve Master Panel Spec V1.pdf`
2. Mockups oficiais:
   - `layout tela loggin.png`
   - `layout painel medico.png`
   - `layout tela prontuario.png`
3. Fluxos operacionais ja validados no staging

## Escopo executado (frontend apenas)

- Projeto: `mdoctor-panel`
- Rotas ajustadas:
  - `/login`
  - `/dashboard`
  - `/prontuario/:id`
  - `/memed/:id` (preservada e validada visualmente no fluxo)
- Sem alteracao de backend, APIs, n8n, Supabase schema, Stripe ou Memed producao.

## Ajustes implementados

### Login

- Layout em duas colunas com branding medico premium.
- Card de login à direita, com hierarquia visual, checkbox e link visual de recuperacao.
- CTA principal: `ACESSAR PAINEL`.
- Rodape institucional e identidade Doctor Prescreve.
- Autenticacao e redirecionamento existentes preservados.

### Dashboard medico

- Header alinhado ao spec:
  - branding Doctor Prescreve
  - botao `PRONTUARIO`
  - badge `Certificado digital conectado (Memed)`
  - perfil medico e botao `SAIR`
- Linha divisoria dourada abaixo do header.
- 3 colunas operacionais com scroll interno:
  - Fila de espera
  - Em atendimento
  - Receitas prontas
- Cards com badges e botoes operacionais:
  - `Atender`
  - `Visualizar receita`
  - `Aceitar receita`
  - `Enviar por WhatsApp`
  - `E-mail`
  - `SMS`
- Rodape LGPD/institucional no dashboard.

### Prontuario medico

- Header visual com branding, perfil medico e `SAIR`.
- Botao `Voltar para painel`.
- Titulo e subtitulo centrais conforme spec.
- Banner de elegibilidade com selo `VERIFICADO`.
- Estrutura em duas colunas:
  - Dados do paciente
  - Historia clinica e blocos clinicos
- Blocos clinicos com icones consistentes:
  - Queixa principal
  - Historico clinico
  - Exame fisico
  - Alergias
  - Medicacoes em uso
  - Conduta medica
- Acoes finais:
  - `Receita anexada`
  - `Editar`
  - `Reprovar`
  - `Aprovar`
- Campo `Conduta medica opcional` com placeholder alinhado ao layout oficial.

### Visual global

- Tokens e linguagem visual premium healthtech:
  - azul medico
  - dourado da marca
  - branco/off-white
  - verde para sucesso
  - vermelho para reprovação/saida
- Bordas arredondadas, sombras suaves e microinteracoes discretas.
- Scrollbars internas discretas para colunas operacionais.

## Compatibilidade funcional preservada

- Login e sessao atuais preservados.
- Fluxo de dashboard preservado.
- Fluxo de prontuario (aprovar/reprovar) preservado.
- Fluxo Memed mock preservado.
- Delivery mock e fallback preservados.
- Sem impacto em correlation/auditabilidade/backend staging.

## Validacoes executadas

- `npm --prefix mdoctor-panel run lint`:
  - sem erros
  - 2 warnings preexistentes fora do escopo das telas ajustadas
- `npm --prefix mdoctor-panel run build`: OK
- Rotas staging:
  - `/login`: 200
  - `/dashboard`: 200
  - `/prontuario/:id`: 200
  - `/memed/:id`: 200

## Conclusao

- UI do painel alinhada ao Master Panel Spec V1 e layouts oficiais, mantendo o fluxo operacional staging funcional e sem alterações em produção.
