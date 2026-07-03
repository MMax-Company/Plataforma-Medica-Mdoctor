# Regras Permanentes de Desenvolvimento

Este arquivo não documenta o projeto. Ele registra regras permanentes que devem
ser consideradas automaticamente antes de qualquer tarefa, em todas as sessões.

## Regras

1. Não alterar fluxos oficiais sem solicitação explícita.
2. Antes de criar novas funções, verificar se já existe implementação equivalente.
3. Priorizar a correção da causa raiz em vez de soluções temporárias (workarounds).
4. Não remover funcionalidades existentes para corrigir outra.
5. Não alterar layout/frontend quando a solicitação for apenas de backend.
6. Não alterar backend quando a solicitação for apenas de frontend.
7. Fazer alterações mínimas e objetivas, sem expandir o escopo da tarefa.
8. Manter compatibilidade com o código existente.
9. Um commit por funcionalidade.
10. Separar correções de bugs de novas funcionalidades (commits e escopos distintos).
11. Antes de concluir uma tarefa, verificar se não houve regressão no fluxo relacionado.
12. Quando houver dúvida sobre uma regra de negócio, perguntar antes de alterar o
    comportamento esperado.
13. Sempre preservar a arquitetura existente, salvo solicitação explícita em contrário.

## Manutenção deste arquivo

- Manter enxuto (30-50 linhas).
- Atualizar apenas quando surgir uma nova regra permanente de desenvolvimento.
- Não incluir aqui: documentação técnica, estado atual do projeto, listas de
  tarefas, pendências ou qualquer informação que mude com frequência.
