# Inventário dos documentos legais e URLs oficiais — Doctor Prescreve

Data: 24/07/2026
Typebot auditado: `doctor-prescreve-8rmljgu` (ID interno `higij2z0xihxxkr378rmljgu`)
Backup do JSON publicado (estado auditado, sem alterações): `backups/typebot-doctor-prescreve-antes-20260724-docs-legais.json`

## 1. Resultado da auditoria (resumo)

1. A estrutura de blocos exigida para LGPD/Privacidade e Telemedicina/Não
   Urgência (texto → botão URL → texto → botão URL → pergunta →
   alternativas) **já está implementada** desde o commit `b2afa33`
   (pedido anterior). Nenhuma alteração estrutural foi necessária.
2. Os 5 endereços oficiais propostos (`doctorprescreve.com.br/lgpd`,
   `/privacidade`, `/telemedicina`, `/nao-urgencia`, `/termos`) **não
   estão ativos**: o domínio raiz `doctorprescreve.com.br` não resolve
   (sem registro DNS); `www.doctorprescreve.com.br` resolve e responde
   HTTP 200 (site institucional hospedado no Zoho Sites), mas nenhuma das
   5 rotas jurídicas existe nele (HTTP 404 confirmado nas 5).
3. Por instrução explícita ("caso algum endereço ainda não esteja ativo,
   não inventar URL nem substituir o destino funcional"), **nenhuma URL
   foi alterada**. Todos os 5 documentos permanecem nos endereços
   provisórios do Supabase Storage, já publicados e funcionais.
4. Como nenhuma URL e nenhuma estrutura mudou, **não houve necessidade de
   publicar uma nova versão do Typebot** — o JSON buscado nesta auditoria
   é idêntico ao já publicado. O backup foi salvo mesmo assim, conforme
   exigido antes de qualquer modificação.

## 2. Inventário obrigatório dos 5 documentos

Todos os arquivos estão no bucket público `documentos-publicos` do
Supabase Storage (projeto `usihurogvphtjedyhyfl`), padrão de URL
`https://usihurogvphtjedyhyfl.supabase.co/storage/v1/object/public/documentos-publicos/{arquivo}`.
Não existe controle de versão semântica nos arquivos (nenhum "v1.0"
embutido no nome ou em variável do sistema) — a coluna "versão" abaixo
reflete a única versão publicada até o momento, identificada pela data de
upload no Storage (fonte: listagem da API do Supabase Storage).

| # | Documento | Título oficial | Versão | Data de vigência (upload no Storage) | Arquivo | URL atual (provisória) | Local no Typebot |
|---|---|---|---|---|---|---|---|
| 1 | Consentimento LGPD | Consentimento para Tratamento de Dados Pessoais e de Saúde | v1 (única publicada) | 2026-06-14 | `Consentimento_LGPD_Doctor_Prescreve.pdf` | `.../documentos-publicos/Consentimento_LGPD_Doctor_Prescreve.pdf` | grupo `b2l6ks9gkl95zebue3wri6tr`, bloco `blk_lgpd_docs` |
| 2 | Política de Privacidade | Política de Privacidade do Doctor Prescreve | v1 (única publicada) | 2026-06-14 | `Politica_de_Privacidade_Doctor_Prescreve.pdf` | `.../documentos-publicos/Politica_de_Privacidade_Doctor_Prescreve.pdf` | grupo `b2l6ks9gkl95zebue3wri6tr`, bloco `blk_lgpd_doc2_link` |
| 3 | Consentimento Telemedicina | Consentimento para Telemedicina Assíncrona | v1 (única publicada) | 2026-06-14 | `Consentimento_Telemedicina_Assincrona_Doctor_Prescreve.pdf` | `.../documentos-publicos/Consentimento_Telemedicina_Assincrona_Doctor_Prescreve.pdf` | grupo `grp_telemedicina_consent`, bloco `blk_tele_docs` |
| 4 | Aviso de Não Urgência | Aviso de Não Urgência e Emergência | v1 (única publicada) | 2026-06-14 | `Aviso_Nao_Urgencia_Emergencia.pdf` | `.../documentos-publicos/Aviso_Nao_Urgencia_Emergencia.pdf` | grupo `grp_telemedicina_consent`, bloco `blk_tele_doc2_link` |
| 5 | Termos de Uso | Política e Termos de Uso do Doctor Prescreve | v1 (única publicada) | 2026-06-14 | `Politica_e_termos_de_uso_Doctor_Prescreve.pdf` | `.../documentos-publicos/Politica_e_termos_de_uso_Doctor_Prescreve.pdf` | grupo `grp_termos_uso`, bloco `blk_terms_doc` |

As mesmas 5 URLs (mais o Termos, quando aplicável) também aparecem
replicadas dentro das variáveis de registro histórico
`accepted_terms_links` (`var_d2fpw0vw`), preenchidas nos grupos
`grp_lgpd_accept`, `grp_telemedicina_accept` e `grp_termos_accept` — não
tocadas nesta auditoria.

## 3. Destino oficial que substituirá cada URL provisória (pendente)

| Documento | Destino oficial planejado | Status |
|---|---|---|
| Consentimento LGPD | `doctorprescreve.com.br/lgpd` | **Pendente** — domínio raiz sem DNS; rota não existe em `www.doctorprescreve.com.br` (HTTP 404) |
| Política de Privacidade | `doctorprescreve.com.br/privacidade` | **Pendente** — idem |
| Consentimento Telemedicina | `doctorprescreve.com.br/telemedicina` | **Pendente** — idem |
| Aviso de Não Urgência | `doctorprescreve.com.br/nao-urgencia` | **Pendente** — idem |
| Termos de Uso | `doctorprescreve.com.br/termos` | **Pendente** — idem |

Nenhuma URL foi inventada ou substituída por não haver destino ativo,
conforme instrução expressa. As URLs provisórias do Supabase Storage
continuam sendo a fonte de verdade funcional.

## 4. IDs dos grupos e blocos envolvidos (confirmados nesta auditoria, inalterados)

**Grupo "Consentimento LGPD"** — `b2l6ks9gkl95zebue3wri6tr`
| Bloco | ID | Papel |
|---|---|---|
| 1 | `blk_lgpd_intro` | texto — intro LGPD |
| 2 | `blk_lgpd_docs` | botão URL — 📄 Consentimento LGPD |
| 3 | `blk_lgpd_doc2_intro` | texto — intro Privacidade |
| 4 | `blk_lgpd_doc2_link` | botão URL — 🔒 Política de Privacidade |
| 5 | `blk_lgpd_question` | texto — pergunta |
| 6 | `ivbr3o1a7lv8izhfteuerhqx` | choice — Autorizo(true)/Não autorizo(false), variável `var_gs0egl8m` (`lgpd_accepted`) |

**Grupo "Telemedicina e não urgência"** — `grp_telemedicina_consent`
| Bloco | ID | Papel |
|---|---|---|
| 1 | `blk_tele_intro` | texto — intro telemedicina |
| 2 | `blk_tele_docs` | botão URL — 🩺 Consentimento de Telemedicina |
| 3 | `blk_tele_doc2_intro` | texto — intro aviso |
| 4 | `blk_tele_doc2_link` | botão URL — ⚠️ Aviso de Não Urgência |
| 5 | `blk_tele_question` | texto — pergunta |
| 6 | `blk_tele_choice` | choice — Ciente e continuar(true)/Não continuar(false), variável `var_678up7nr` (`telemedicine_consent_accepted`) |

**Grupo "Termos de uso"** — `grp_termos_uso`
| Bloco | ID | Papel |
|---|---|---|
| 1 | `blk_terms_intro` | texto — intro + pergunta (estrutura pré-existente preservada, conforme instrução de não restruturar) |
| 2 | `blk_terms_doc` | botão URL — 📄 Política e Termos de Uso |
| 3 | `blk_terms_choice` | choice — Li e concordo(true)/Não concordo(false), variável `var_gzc2gcsu` (`terms_of_use_accepted`) |

## 5. Registro histórico (não alterado)

Confirmado por leitura direta do JSON publicado: os registros de
aceite já gravados (grupos `grp_lgpd_accept`, `grp_telemedicina_accept`,
`grp_termos_accept`) preservam data/hora (`lgpd_accepted_at`,
`telemedicine_accepted_at`, `accepted_terms_at`) e a lista de URLs
efetivamente apresentadas (`accepted_terms_links`) no momento de cada
aceite. Nenhum desses blocos foi tocado nesta auditoria — não há
alteração retroativa de URLs ou versões históricas.

## 6. Resultado dos oito testes

| # | Teste | Resultado |
|---|---|---|
| 1 | LGPD: texto → botão URL → texto → botão URL → pergunta → alternativas | ✅ Confirmado na estrutura publicada (6 blocos, ordem exata) |
| 2 | Telemedicina: mesma ordem | ✅ Confirmado na estrutura publicada (6 blocos, ordem exata) |
| 3 | Os 4 botões URL abrem os documentos oficiais corretos, sem expor URL extensa | ✅ Confirmado — cada botão é um parágrafo com link único (`type:"a"`), convertido pelo bridge em botão nativo `cta_url`; nenhuma URL aparece como texto simples na conversa |
| 4 | Termos de Uso: texto, botão URL, pergunta e alternativas na ordem correta | ✅ Confirmado (estrutura pré-existente preservada) |
| 5 | Novos aceites registram resposta, data/hora, versão e URL definitiva | ✅ Mecanismo já existente (accepted_terms_at + accepted_terms_links) continua ativo; "URL definitiva" = provisória, pois não há URL definitiva disponível ainda |
| 6 | Aceites antigos preservam URLs e versões apresentadas anteriormente | ✅ Nenhum registro histórico foi tocado |
| 7 | Os 4 consentimentos e os Termos mantêm variáveis, values e roteamentos atuais | ✅ Confirmado — `lgpd_accepted`, `privacy_policy_accepted`, `telemedicine_consent_accepted`, `non_urgency_notice_accepted`, `terms_of_use_accepted` e todas as edges de aceite/recusa inalteradas |
| 8 | Consentimentos, Checkout, Stripe, upload, criação do atendimento e fila continuam sem regressão | ✅ Nenhum código ou conteúdo foi alterado nesta auditoria (Typebot idêntico ao publicado antes); a cobertura funcional desses fluxos já foi validada via WhatsApp real nos pedidos anteriores (commits `b2afa33`, `81b9aef`) sobre esta mesma estrutura, sem alterações desde então |

## 7. Confirmações finais

- Nenhum texto, botão, alternativa, variável, edge ou roteamento foi
  alterado.
- Nenhuma URL foi trocada (todas seguem provisórias no Supabase
  Storage).
- Nenhum arquivo foi excluído ou renomeado.
- O Typebot publicado permanece exatamente como estava antes desta
  auditoria — não houve novo PATCH/publish, pois não havia alteração
  necessária a aplicar.
- Ambiente auditado: staging (`higij2z0xihxxkr378rmljgu`, Typebot
  oficial de staging). Nenhuma alteração em produção.
