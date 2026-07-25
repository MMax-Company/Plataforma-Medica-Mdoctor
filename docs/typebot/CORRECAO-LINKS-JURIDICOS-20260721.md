# Doctor Prescreve — Apresentação dos links jurídicos no WhatsApp

**Data/hora de publicação:** 2026-07-21 (pedido isolado e econômico, só apresentação — URLs, botões e lógica de aceite preservados)

---

## Identificação

| Campo | Valor |
|-------|-------|
| Typebot ID (interno) | `higij2z0xihxxkr378rmljgu` |

---

## Blocos alterados

### 1. `blk_lgpd_docs` (grupo `b2l6ks9gkl95zebue3wri6tr`, Consentimento LGPD) — já correto, sem alteração
Já usava `📄 ` + link clicável (rich-text `a`), sem URL bruta visível. Confirmado e mantido:
- 📄 **Consentimento LGPD**
- 📄 **Política de Privacidade**

### 2. `blk_tele_docs` (grupo `grp_telemedicina_consent`, Telemedicina e não urgência)
| | Antes | Depois |
|---|---|---|
| Formato | Título em texto simples + URL bruta em linha própria, para cada documento | `📄 ` + nome clicável, uma linha por documento |
| Exibição | "📄 Consentimento Telemedicina Assíncrona:\nhttps://...pdf\n\n📄 Aviso Importante — Não Urgência/Emergência:\nhttps://...pdf" | 📄 **Consentimento para Telemedicina Assíncrona**<br>📄 **Aviso Importante — Não Urgência/Emergência** |

### 3. `blk_terms_doc` (grupo `grp_termos_uso`, Termos de uso)
| | Antes | Depois |
|---|---|---|
| Formato | Título em texto simples + URL bruta em linha própria | `📄 ` + nome clicável |
| Exibição | "📄 Política e Termos de Uso:\nhttps://...pdf" | 📄 **Política e Termos de Uso** |

---

## Confirmação dos 5 destinos (URLs preservadas, sem criar/inventar nenhuma)

Cada URL foi confirmada em **duas fontes independentes** já existentes no Typebot antes da alteração: o próprio bloco de exibição e a variável `var_d2fpw0vw` (JSON usado nos grupos "Registro telemedicina"/"Registro termos" para o resumo do aceite) — ambas batendo exatamente.

| Documento | URL (inalterada) |
|---|---|
| Consentimento LGPD | `.../Consentimento_LGPD_Doctor_Prescreve.pdf` |
| Política de Privacidade | `.../Politica_de_Privacidade_Doctor_Prescreve.pdf` |
| Consentimento para Telemedicina Assíncrona | `.../Consentimento_Telemedicina_Assincrona_Doctor_Prescreve.pdf` |
| Aviso Importante — Não Urgência/Emergência | `.../Aviso_Nao_Urgencia_Emergencia.pdf` (localizada no bloco já existente, não criada) |
| Política e Termos de Uso | `.../Politica_e_termos_de_uso_Doctor_Prescreve.pdf` |

## Não alterado (confirmado na reverificação)

- Botões e `outgoingEdgeId` de cada grupo (Autorizo/Não autorizo, Ciente e continuar/Não continuar, Li e concordo/Não concordo).
- Nenhum `variableId`, `blockId`, `groupId` ou `edge` criado, removido ou alterado.
- Textos jurídicos dos documentos (PDFs) — não tocados, apenas a apresentação do link no chat.
- Correções dos pedidos anteriores de hoje (botão inicial, condição clínica, telemedicina intro, critérios de elegibilidade, "consulta médica", resumo clínico) — todas confirmadas intactas.
- Cada documento permanece no MESMO ponto do fluxo em que já estava (LGPD com 2 docs, Telemedicina com 2 docs, Termos com 1 doc) — nenhuma reordenação ou consolidação entre grupos.

---

## Backups

- Antes: `backups/typebot-doctor-prescreve-antes-20260721-doclinks.json`
- Depois: `backups/typebot-doctor-prescreve-depois-20260721-doclinks.json`

## Teste mínimo

Assertions automatizadas no próprio script de publicação, executadas ANTES do PATCH (confirmando a causa: URL bruta presente) e DEPOIS da publicação via nova leitura independente do Typebot publicado:
- Os 5 nomes de documento aparecem exatamente como esperado.
- Nenhum bloco contém a URL bruta como texto visível.
- Todos os 5 links continuam como elemento `a` (clicável) apontando para a mesma URL de antes.
- Snapshot estrutural (`groupIds`/`blockIds`/`edgeIds`/`variableIds`) idêntico antes/depois — nenhuma regressão.
- Botões e `outgoingEdgeId` de cada grupo de consentimento confirmados inalterados.
