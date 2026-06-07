# Investigação cirúrgica — Memed setPaciente

> 2026-06-07 · Atendimento `c302bd9e-060a-4ee8-b4cf-0c78392f60c6` · Staging Railway

Evidência completa: `docs/MEMED-SETPACIENTE-CIRURGICO.json`  
Spec reprodutível: `e2e/memed-setpaciente-surgical.spec.ts`

---

## Conclusão principal

**O comando correto é `setPaciente` no módulo `plataforma.prescricao`.**  
O bloqueio **não** é ausência de contrato — é **payload incompatível** enviado hoje pelo painel.

| Payload | Resultado | Tempo |
|---------|-----------|-------|
| **BASELINE (atual do painel)** — nome longo + cpf + email + data_nascimento | **TIMEOUT 12s** | Promise não resolve |
| **TEST A (mínimo)** — nome curto + telefone + idExterno | **OK** | ~1,5s |
| **Todos extras + nome curto** (cpf + email + data_nascimento) | **OK** | ~1,5s |
| **Nome longo isolado** | **OK** | ~1,8s |
| cpf / email / data_nascimento isolados | **OK** | ~1,5–2,5s |
| cpf + email | **OK** | ~1,7s |
| cpf + email + data_nascimento (nome curto) | **OK** | ~1,5s |

**Campo/combinação que trava:**  
`nome` longo (`PACIENTE TESTE 05 - RENOVAÇÃO RECEITA`) **+** `cpf` **+** `email` **+** `data_nascimento` **juntos**.

Nenhum campo isolado trava. A combinação completa do `buildPatientFromAtendimento` reproduz o hang.

---

## 1. Comando que funciona

| Item | Valor |
|------|-------|
| **Módulo** | `plataforma.prescricao` |
| **Comando** | `setPaciente` |
| **Método** | `MdHub.command.send(module, command, payload)` |

### Comandos que **não** funcionam para paciente

| Comando | Módulo | Resultado |
|---------|--------|-----------|
| `setPatient` | plataforma.prescricao | REJECT (~2ms) |
| `setPatientData` | plataforma.prescricao | REJECT (~1ms) |
| `setPaciente` | plataforma.usuario | REJECT |
| `setPaciente` | platform.patient-management | REJECT |
| `setPaciente` | plataforma.patient-management | REJECT |

`setAdditionalData` responde OK, mas **não preenche paciente** — grava em `additionalData`, `paciente: null`.

---

## 2. Payload que funciona (TEST A)

```json
{
  "nome": "PACIENTE TESTE 05",
  "telefone": "11988700005",
  "idExterno": "c302bd9e-060a-4ee8-b4cf-0c78392f60c6"
}
```

- **Tempo:** 1554 ms  
- **Resposta:** prescrição criada, `paciente` preenchido, `medicamentos: []`  
- **newPrescription após OK:** 73 ms  

Também funcionam: `external_id`, `id_externo`, sem telefone (TEST B), campos vazios memed-react (TEST C).

---

## 3. Payload que trava (BASELINE = painel atual)

```json
{
  "nome": "PACIENTE TESTE 05 - RENOVAÇÃO RECEITA",
  "telefone": "11988700005",
  "idExterno": "c302bd9e-060a-4ee8-b4cf-0c78392f60c6",
  "cpf": "23100299900",
  "email": "homolog.teste05@mdoctor.local",
  "data_nascimento": "22/01/1964"
}
```

- **Tempo:** TIMEOUT 12s (sem resolve/reject)  
- **newPrescription:** não executado  

---

## 4. getUsuario (baseline)

- **OK** em 12–2915 ms (varia com carga do módulo)  
- Prescritor: Max Vinicius Ferreira Matos, CRM 163032/SP, ambiente produção  

---

## 5. Console / rede relevantes

- Console: `[error] Error {error: idExterno do paciente é obrigatório!}` — em probes com comando inválido  
- Console: `platform.patient-management` e `plataforma.prescricao` em execução  
- Rede: `GET https://api.memed.com.br/v1/usuarios` → 200  
- Script: `sinapse-prescricao.min.js` produção  

---

## 6. Implicação para o fluxo Doctor Prescreve

O painel monta via `buildPatientFromAtendimento` exatamente o **BASELINE** (nome completo da triagem + cpf + email + data_nascimento).  
Isso explica o hang em produção **sem** bug de comando errado.

**Correção futura (quando autorizado, não aplicada agora):**

- Enviar a Memed somente payload mínimo ou nome curto + idExterno (+ telefone opcional)  
- Manter cpf/email/data_nascimento na camada clínica interna, **não** no `setPaciente`  
- Ou truncar/simplificar `nome` antes do `setPaciente`  

---

## 7. Dossiê suporte Memed (se necessário)

| Campo | Valor |
|-------|-------|
| Prescritor | Max Vinicius Ferreira Matos |
| CRM/UF | 163032 / SP |
| external_id prescritor | dr_max_vinicius_001 |
| Ambiente | produção (Sinapse) |
| Token / getUsuario | OK |
| Comando | `plataforma.prescricao.setPaciente` |
| Payload mínimo | OK em ~1,5s |
| Payload completo atual | TIMEOUT sem resposta |
| Combinação problemática | nome longo + cpf + email + data_nascimento |

---

## 8. Próximo passo (após autorização)

1. Ajustar **somente** `buildSetPacientePayload` / `setMemedPatient` para payload mínimo compatível  
2. Validar fluxo completo: setPaciente OK → newPrescription → addItem → show  
3. Só então commit/deploy  

**Sem commit nesta etapa.**
