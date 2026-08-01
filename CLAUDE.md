# Regras Permanentes — Claude Code

Este arquivo deve ser considerado automaticamente antes de qualquer tarefa.
Ele contém regras permanentes; o estado operacional compartilhado fica em
`docs/PROJECT_MEMORY.md`.

## Preflight obrigatório

1. Ler este arquivo, `AGENTS.md` e `docs/PROJECT_MEMORY.md` antes de investigar,
   alterar código, criar commit, fazer push ou deploy.
2. Confirmar branch, `git status` e ambiente-alvo antes de qualquer escrita.
3. Investigar o código e a fonte de dados relevantes antes de propor correção.
4. Se a instrução atual conflitar com a memória ou houver dúvida de negócio,
   parar e perguntar ao usuário.

## Regras de desenvolvimento

1. Não alterar fluxos oficiais sem solicitação explícita.
2. Antes de criar funções, verificar se já existe implementação equivalente.
3. Corrigir a causa raiz; não introduzir workaround sem autorização.
4. Não remover funcionalidades existentes para corrigir outra.
5. Respeitar o escopo entre frontend, backend, automação e infraestrutura.
6. Fazer alterações mínimas, objetivas e compatíveis com a arquitetura atual.
7. Preservar alterações do usuário e arquivos fora do escopo.
8. Separar funcionalidades e correções independentes em commits distintos.
9. Verificar somente o fluxo relacionado e evitar regressões.
10. Nunca apagar ou modificar dados reais em limpezas de teste sem autorização.

## Ambientes e economia

1. Staging é o destino padrão. Produção, `main`, cherry-pick para `main` e deploy
   de produção exigem autorização explícita na solicitação atual.
2. "Pedido econômico" significa investigação pontual, sem auditoria ampla,
   varredura cansativa ou testes exaustivos; executar apenas validação essencial.
3. Commit, push e deploy devem usar somente o escopo e o ambiente autorizados.

## Memória compartilhada

- Atualizar `docs/PROJECT_MEMORY.md` quando uma decisão permanente, arquitetura,
  ambiente ou estado operacional relevante mudar.
- Não guardar segredos, tokens, dados pessoais ou logs extensos na memória.
- A memória orienta; código, banco e ambiente atual devem confirmar fatos mutáveis.
