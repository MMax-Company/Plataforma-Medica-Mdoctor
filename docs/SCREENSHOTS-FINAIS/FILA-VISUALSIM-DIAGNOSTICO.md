# Diagnóstico — `/fila?visualSim=1`

**Data:** 2026-05-31  
**URL testada:** http://localhost:3000/fila?visualSim=1  
**Viewport:** 1280×720  
**Screenshot:** `fila-visualsim-diagnostico-atual.png` (cópia em `02-painel-medico-final.png`)  
**JSON:** `FILA-VISUALSIM-DIAGNOSTICO.json`

---

## Resumo executivo

Não houve mistura de CSS antigo com classes legadas nos minicards (`dp-patient-card` único, sem `patient-card` legado). O modo `visualSim=1` carrega **apenas 10 pacientes fictícios** (6 fila / 3 atendimento / 1 pronta) e **não chama** `/api/atendimentos/*` na carga.

O que parecia “quebrado/misturado” vinha principalmente de:

1. **Conflito de porta** — `next start` (build antigo) e `next dev` competindo; abrir a porta errada mostra UI desatualizada.
2. **Altura do shell 768px** em viewport **720px** — `fila/layout.tsx` com `min-h-[768px]` cortava o rodapé e gerava scroll vertical (48px).
3. **Densidade interna dos cards** — variante `--queue` com zona de ações 48px vs 84px nas outras colunas (percepção de alturas diferentes apesar de 168px externos).

---

## Checklist (10 itens)

| # | Item | Resultado |
|---|------|-----------|
| 1 | Layout do painel médico | OK — header, faixa suporte, 3 colunas |
| 2 | Minicards mesma altura | OK — 10 cards × **168px** (`cardHeightDelta: 0`) |
| 3 | CSS antigo misturado | **Não** — só classes `dp-patient-*` |
| 4 | Sobrescrita de `dp-patient-card` | **Não** — regras únicas em `globals.css` `@layer components` |
| 5 | `visualSim=1` só fictícios | OK — 10 cards, colunas 6/3/1; **0** chamadas API fila na carga |
| 6 | Header padrão aprovado | OK — altura **120px** |
| 7 | Colunas layout aprovado | OK — grid 3 colunas, títulos e badges |
| 8 | Duplicação / desalinhamento | **Parcial** — zona de ações da coluna “Prontas” visualmente mais compacta (3 botões em 84px) |
| 9 | Rodapé | **Corrigido** — estava fora do viewport 720px por shell 768px |
| 10 | Overflow | Sem overflow horizontal; scroll vertical vinha do shell 768px |

---

## Dados fictícios vs reais

- IDs na tela aparecem como `#ATD-01` … (formatação de exibição), não `vis-sim-p01`.
- Todos os pacientes são da simulação (`vis-sim-*` no estado interno).
- Suporte WhatsApp: 6 itens fictícios (`vis-sim-sup-*`).

---

## Correções mínimas aplicadas

| Arquivo | Alteração |
|---------|-----------|
| `src/app/fila/layout.tsx` | `min-h-[768px]` → `h-[720px] min-h-[720px]` (viewport homologado) |
| `src/app/fila/page.tsx` | `main` `h-[768px]` → `h-[720px]`; `data-visual-sim="1"` quando sim ativo |
| `src/app/globals.css` | Removida zona 48px só na fila; removido bloco duplicado `.panel-header__name` no fim do arquivo |
| `scripts/diagnose-fila-visual.js` | Script de captura + métricas (novo) |

---

## Como validar localmente

Use **uma** instância na porta que você abrir no navegador:

```powershell
cd mdoctor-panel
# Parar processos Node antigos nas portas 3000/3001 se necessário
npm run dev
# Abrir a URL exibida no terminal (ex.: http://localhost:3000/fila?visualSim=1)
```

Se usar produção:

```powershell
npm run build
npx next start -p 3000
```

**Não** deixar `next dev` e `next start` na mesma porta — isso serve build antigo e parece “mistura visual”.

Diagnóstico automatizado:

```powershell
$env:PANEL_URL='http://127.0.0.1:3000'  # mesma porta do servidor ativo
node scripts/diagnose-fila-visual.js
```

---

## Confirmação padrão visual

Após reiniciar o servidor com o código atual: painel alinhado ao padrão aprovado em viewport **1280×720**, minicards **168px** uniformes, `visualSim` isolado, rodapé visível sem scroll extra.
