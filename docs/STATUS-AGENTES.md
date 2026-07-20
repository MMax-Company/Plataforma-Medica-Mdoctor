# Status dos Agentes — WhatsApp + Typebot

**Atualizado:** 2026-07-20  
**Uso:** memória operacional para continuidade (Cláudio / Cursor). Não duplicar este conteúdo em `CLAUDE.md` (lá ficam só regras permanentes).

**Fonte oficial do fluxo (perguntas/respostas/ordem/controladores):**  
`docs/typebot/FLUXO-OFICIAL-PERGUNTAS-RESPOSTAS.md`

---

## 1. Arquitetura oficial

- **Meta Cloud API** é a única entrada oficial do WhatsApp.
- Endpoint oficial: `POST /api/whatsapp/webhook`
- Backend controla:
  - menu 1/2;
  - sessão WhatsApp/Typebot;
  - início e continuação do Typebot;
  - pagamento Stripe Checkout;
  - upload de receita anterior;
  - suporte;
  - idempotência.
- Typebot oficial:
  - `publicId`: `doctor-prescreve-8rmljgu`
  - ID interno: `higij2z0xihxxkr378rmljgu`
- n8n atua somente em triagem, notificações e entrega.
- **Evolution** e **Baileys** não fazem parte do fluxo atual.

---

## 2. PRs e commits concluídos

| PR | Escopo |
|----|--------|
| #27 | consolidação WhatsApp + Typebot |
| #28 | integração n8n |
| #29 | sessão Typebot ativa tem prioridade sobre menu 1/2 |
| #30 | correção da aresta após elegibilidade |

**Main atual (após merges):** `c50bf8c82d3ebb01a6b7b14b94db7f5295a3ac4a`

Principais commits: `9465ab9`, `db5742d`, `721d959`, `fb53088`, `5b15e71`, `ab94adf`, `746dd20`, `cb955aa`, `5cf9eb5`, `200fbca`.

---

## 3. Staging

- Backend staging implantado e saudável.
- Provider Meta ativo.
- n8n staging com workflows publicados:
  - `typebot-webhook-staging`
  - `clinical-rejection-notify-staging`
  - `prescription-delivery-staging`
- Workflows antigos permanecem desativados.
- Phone Number ID correto: `1030563506816702` (não usar o typo `103056350816702`)
- WABA: `1293601975703284`
- Paciente de teste humano: `5511985485777`

---

## 4. Correções já feitas (não repetir)

- Menu 1/2 consolidado.
- Opção 1 inicia Typebot oficial.
- Opção 2 abre suporte sem Typebot.
- Sessão Typebot ativa aceita respostas `1` e `2` sem reiniciar.
- Múltipla escolha clínica corrigida.
- “Nenhum destes” corrigido para `NAO`.
- Elegibilidade corrigida para avançar aos dados pessoais.
- Pagamento unificado no Stripe Checkout do backend.
- Upload direto pelo WhatsApp consolidado.
- Suporte idempotente e rotas antigas bloqueadas.
- CEP e endereço separados.
- Edge do endereço corrigido.
- Sessão morta anterior foi reconstruída com variáveis preservadas.

---

## 5. Estado atual do teste humano (bloqueio ativo)

| Campo | Valor |
|-------|--------|
| Paciente | `5511985485777` |
| Sessão Typebot | `bqinu71o81n1xvn27uxwfohk` |
| Bloco atual | `blk_nggi0xs0` |
| Prompt | Via de administração do medicamento 1 |
| Variável esperada | `med1_via` |

**Problema atual**

- Sessão permanece presa no bloco de via.
- Schema anterior da sessão aceitava apenas `Via oral` / `Outra via`.
- JSON atual do bot foi alterado para: Oral, Sublingual, Tópica, Inalatória, Outra.
- Mesmo enviando `Oral`, a sessão **não avança**.
- Hipótese: divergência entre label / value / content e **schema congelado** da sessão.
- **Não** publicar novas versões nem reiniciar o fluxo inteiro antes de confirmar o valor efetivamente aceito pela sessão viva.
- Preservar dados já preenchidos; não limpar sessão; não enviar mensagens em nome do paciente sem solicitação.

---

## 6. Dados já preservados na sessão

- LGPD
- condições clínicas
- tempo de uso
- sinais de alerta
- telemedicina
- elegibilidade
- nome, nascimento, CPF, WhatsApp, e-mail
- CEP e endereço
- resposta sobre receita anterior
- dados do medicamento já preenchidos antes da via

---

## 7. Próximo foco (Cláudio)

1. Confirmar na sessão viva `bqinu71o81n1xvn27uxwfohk` qual texto/value o choice `blk_nggi0xs0` aceita de fato.
2. Destravar só o bloco de via, sem reiniciar o fluxo e sem perder variáveis.
3. Só depois: publicar / alinhar schema se ainda necessário.
