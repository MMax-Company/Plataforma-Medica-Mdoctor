# Diagnóstico Memed — setPaciente (c302bd9e)

> Gerado: 2026-06-07 · Painel local `http://127.0.0.1:3002` (build com instrumentação) · Backend staging

## Status funcional do card

| Etapa | Resultado | Evidência |
|-------|-----------|-----------|
| Conversão clínica → Memed | OK | `scripts/verify-clinical-prescription-memed.ts` |
| getUsuario | **OK** (12 ms) | MdHub `plataforma.usuario.getUsuario` |
| setPaciente | **TIMEOUT** (30 s) | Promise não resolve |
| newPrescription | Não executado | Bloqueado após setPaciente |
| addItem | Não executado | Bloqueado após setPaciente |
| Medicamento pré-preenchido na UI | **Não validado** | Widget não abriu fluxo completo |

**Tarefa: parcialmente concluída** — aguardando destravamento de `setPaciente` antes de commit/deploy.

---

## 1. Timeout em setPaciente

| Camada | Antes do diagnóstico | Agora (código local) |
|--------|----------------------|----------------------|
| `setPaciente` | **Sem timeout** — `await MdHub.command.send(...)` pendurado | **30 s** via `sendMemedCommandWithDiagnostic` |
| Fluxo `openPrescription` | 45 s (`useMemedSinapse`) | 45 s (inalterado) |

Arquivo: `mdoctor-panel/src/lib/memed/memedCommandDiagnostic.ts`

---

## 2. getUsuario → OK

| Campo | Valor |
|-------|-------|
| Método | `MdHub.command.send('plataforma.usuario', 'getUsuario')` |
| Parâmetros | *(nenhum)* |
| Tempo | **12 ms** |
| Resposta (resumo) | Prescritor **Max Vinicius Ferreira Matos**, CRM **163032/SP**, ambiente **producao**, certificado Soluti ativo |

---

## 3. setPaciente → TIMEOUT (bloqueio raiz)

| Campo | Valor |
|-------|-------|
| Método | `MdHub.command.send('plataforma.prescricao', 'setPaciente', payload)` |
| Tempo | **30 016 ms** → timeout explícito |
| Resposta Memed | **Nenhuma** — Promise não resolve nem rejeita |
| Erro capturado | `Timeout 30000ms em plataforma.prescricao.setPaciente` |

### Payload enviado (completo)

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

**Nota:** telefone normalizado de `5511988700005` → `11988700005` (padrão Memed 10–11 dígitos). O hang **persiste** após normalização.

### Evidência staging (código anterior, sem timeout por comando)

No staging Railway, o mesmo comando entrou em estado **PENDENTE** (log `before` sem `after`) por >60 s — mesmo sintoma, sem falha explícita.

---

## 4. newPrescription / addItem

Não executados — `prepareAndShowPrescription` aborta após falha de `setPaciente`.

Payload que **seria** enviado ao `addItem` (Losartana):

```json
{
  "nome": "Losartana 50mg",
  "posologia": "Tomar 1 comprimido por via oral a cada 24 horas. Uso contínuo.",
  "quantidade": 30
}
```

---

## 5. Hipóteses investigadas

| Hipótese | Resultado |
|----------|-----------|
| Payload clínico desorganizado | Descartada — conversão OK |
| Telefone com prefixo `55` | Corrigido — hang persiste |
| Refresh forçado de token a cada abertura | Mitigado — não refresh se módulo já pronto |
| Duplo clique / autoOpen + click | Mitigado no teste |
| getUsuario explícito antes de setPaciente | Removido — causava timeout quando módulo usuario não pronto |
| **setPaciente Memed não responde** | **Confirmado** — bloqueio no widget/API Memed |

---

## 6. Instrumentação adicionada (sem commit)

- `memedCommandDiagnostic.ts` — logs before/after, tempo, payload, resposta, timeout por comando
- `e2e/memed-setpaciente-diagnostic.spec.ts` — captura evidência + `docs/MEMED-SETPACIENTE-DIAGNOSTICO.json`
- Ajustes tentativa fix: `normalizeTelefoneForMemed`, token refresh condicional

---

## 7. Próximo passo recomendado

1. Escalar à Memed com evidência: `setPaciente` não resolve em produção Sinapse (prescritor OK, paciente payload acima).
2. Testar payload mínimo `{ nome, telefone, idExterno }` sem cpf/email/data_nascimento.
3. Só após `setPaciente` OK → validar `addItem` e UI pré-preenchida → então commit/deploy.

**Não executar commit** até evidência funcional completa.
