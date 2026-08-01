# Memória Compartilhada — Doctor Prescreve

**Última atualização:** 01/08/2026  
**Responsável funcional:** Dr. Max Vinicius Ferreira Matos  
**Finalidade:** fonte canônica compartilhada entre Claude Code, Codex e futuros
agentes. Deve ser lida antes de qualquer trabalho no projeto.

## 1. Protocolo obrigatório de início

1. Ler `CLAUDE.md`, `AGENTS.md` e este arquivo por inteiro.
2. Confirmar repositório, branch, alterações locais e ambiente-alvo.
3. Investigar o código e a fonte de dados do fluxo solicitado antes de propor
   ou executar uma correção.
4. Verificar se já existe helper, serviço, rota ou componente equivalente.
5. Se houver conflito entre pedido, memória e comportamento atual, perguntar.

## 2. Ambientes e deploy

- O projeto está em homologação: **staging é o ambiente padrão**.
- Painel staging: `https://painel-medico-staging-staging.up.railway.app`.
- Backend staging: `https://mdoctor-backend-staging-staging.up.railway.app`.
- Não alterar `main`, produção, serviços ou dados de produção sem autorização
  explícita do usuário na solicitação atual.
- "Faça commit e deploy" não autoriza produção por si só; usar staging enquanto
  o usuário estiver revisando o painel.
- Antes do deploy, confirmar branch e serviço Railway vinculados.
- O último deploy de staging informado em 01/08/2026 foi o commit `8ed5292` na
  branch `fix/cep-upload-prescription-20260728`. Confirmar sincronização entre
  Git local, remoto e Railway antes do próximo trabalho.

## 3. Definição de pedido econômico

"Pedido econômico" significa:

- alteração direta e limitada ao problema solicitado;
- investigação pontual, nunca auditoria ampla;
- sem varreduras gerais, testes exaustivos ou refatoração não solicitada;
- reutilizar evidências e diagnósticos existentes;
- executar somente a validação essencial do fluxo alterado;
- relatório final curto: resultado, commit e ambiente.

## 4. Regras permanentes de segurança operacional

- Não apagar pacientes, prontuários, receitas, pagamentos ou jornadas reais.
- Limpeza de testes deve preferir filtro/ocultação segura e critérios conhecidos.
- Não sobrescrever alterações locais ou arquivos do usuário fora do escopo.
- Não incluir tokens, chaves, credenciais ou dados pessoais nesta memória.
- Preservar arquitetura e funcionalidades atuais; mudanças amplas exigem pedido.

## 5. Arquitetura de filas e suporte

Existem três conceitos distintos:

1. **Atendimento clínico:** percorre triagem, fila médica, avaliação, prescrição
   e entrega. Entra nas colunas clínicas, Relação de Pacientes, financeiro e
   indicadores clínicos conforme seu estado.
2. **Ticket de suporte geral:** identificado por `queue_type: support`,
   `whatsapp_support: true` ou `condicao: suporte_whatsapp`. Não é atendimento
   médico e não pode entrar em Aprovados, Rejeitados, Relação de Pacientes,
   financeiro, total ou indicadores clínicos. Aparece apenas na fila própria.
3. **Suporte médico (`medical_support`):** atendimento clínico real encaminhado
   temporariamente para orientação médica. Não confundir com ticket de suporte
   geral e preservar o fluxo de retorno ao administrativo.

O `pagamento_status: CONFIRMADO` usado tecnicamente em ticket de suporte não
representa receita e nunca deve ser somado ao financeiro clínico.

## 6. Indicadores de tempo do Painel Administrativo

Ativos e conectados a timestamps reais:

- **Triagem clínica:** primeira mensagem (`primeiro_oi_em`) até entrada na fila.
- **Espera médica:** entrada na fila até início do atendimento médico.
- **Avaliação médica:** início do atendimento até aprovação ou reprovação.
- **Emissão da receita:** aprovação/início da emissão até entrega da receita.
- **Jornada completa:** primeira mensagem até pós-entrega da receita.

Suporte administrativo e suporte médico permanecem exibindo `—` enquanto não
houver marcadores próprios. Nunca fabricar média. A amostra do cabeçalho usa
somente jornadas completas com os marcadores exigidos e receita entregue.

## 7. Estado operacional registrado em 01/08/2026

- Filtro de testes automáticos aplicado ao painel sem apagar registros do banco.
- Tickets de suporte geral separados do universo clínico e do financeiro.
- Relação de Pacientes usa o cabeçalho operacional do Painel Administrativo.
- No staging, após a separação informada: 18 atendimentos clínicos totais e 12
  pagos; confirmar novamente no ambiente antes de usar esses números no futuro.
- Triagem e jornada completa podem aparecer como `—` em registros antigos sem
  marcadores; isso não significa que os indicadores estejam desligados.

## 8. Canais de WhatsApp protegidos

- O número da automação usa Meta Cloud API.
- O canal manual não deve ser cadastrado em Cloud API, webhook, Typebot ou n8n.
- Não alterar automação, números, provider ou webhook sem pedido específico.

## 9. Manutenção desta memória

Atualizar este arquivo no mesmo trabalho quando mudar:

- decisão permanente de negócio;
- arquitetura de filas, integrações ou dados;
- ambiente/branch ativa ou regra de deploy;
- funcionalidade homologada ou limitação operacional relevante.

Registrar somente o estado final confirmado, com data e commit quando houver.
Remover fatos superados em vez de acumular versões contraditórias. A memória não
substitui a verificação do código, banco, Git e ambiente atual.
