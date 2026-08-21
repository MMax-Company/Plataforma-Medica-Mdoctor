# Instruções Permanentes para Agentes

Estas regras valem para Codex e qualquer agente que trabalhe neste repositório.

## Leitura obrigatória antes de agir

1. Ler `CLAUDE.md` e `docs/PROJECT_MEMORY.md` por inteiro antes de investigar,
   editar, executar testes, criar commit, fazer push ou deploy.
2. Confirmar o diretório raiz, a branch, o `git status` e o ambiente-alvo.
3. Consultar o código e a fonte de dados relevantes; não decidir apenas por
   resumo de conversa, screenshot ou memória antiga.
4. A instrução mais recente do usuário prevalece. Se houver conflito ou dúvida
   material, parar e pedir esclarecimento.

## Execução

- Fazer somente a alteração solicitada e preservar trabalho alheio.
- Procurar implementações e helpers existentes antes de criar duplicações.
- Corrigir a causa raiz sem remover funcionalidades ou mudar arquitetura.
- Não apagar, reclassificar ou modificar dados reais sem autorização explícita.
- Validar o fluxo diretamente afetado e evitar testes fora do escopo.
- Manter correções independentes em commits separados.

## Ambientes protegidos

- Staging é o ambiente padrão do projeto durante a homologação atual.
- Não alterar `main`, produção, serviços de produção ou dados de produção sem
  autorização explícita na solicitação atual.
- Antes de deploy, confirmar branch e serviço de destino. Nunca inferir produção
  apenas porque o usuário pediu "commit e deploy".

## Pedido econômico

Quando o usuário disser "pedido econômico":

- não executar auditoria ampla, varredura geral ou testes exaustivos;
- investigar apenas arquivos, dados e fluxo diretamente relacionados;
- reutilizar diagnósticos existentes e executar validação essencial;
- entregar relatório curto com alteração, commit e ambiente, quando aplicável.

## Atualização da memória

Após uma mudança que altere decisão permanente, arquitetura, integração,
ambiente ou estado operacional relevante, atualizar `docs/PROJECT_MEMORY.md` no
mesmo trabalho. Não registrar segredos, credenciais, dados pessoais ou ruído.

## Baseline visual protegido — Memed

- Preservar o estado homologado em staging no commit `beaf7a0`: conteúdo Memed
  em 40%, barras de rolagem interna e externa visíveis e atalho sticky
  **"Ir para o final ↓"** disponível em todas as etapas abertas.
- O atalho apenas desloca ao fim os contêineres externos controlados pelo Doctor
  Prescreve. A emissão continua exclusivamente no botão original da Memed.
- Qualquer mudança nessa configuração exige pedido explícito e nova validação
  visual; não reaplicar o viewport lógico de 250% nem ocultar barras.
