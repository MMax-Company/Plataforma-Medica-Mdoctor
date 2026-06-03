# Playwright — Tour visual do painel médico

Experiência **headed**, auditável e navegável do fluxo Doctor Prescreve (login → fila → atendimento → prontuário → receita).

## Configuração (`playwright.config.ts`)

| Opção | Valor padrão (dev) |
|--------|---------------------|
| `headless` | `false` |
| `trace` | `on` |
| `screenshot` | `on` |
| `video` | `on` |
| `slowMo` | `300` ms |
| `viewport` | `1366×768` (notebook) |
| Highlight de cliques | script injetado no contexto |

CI ou `HEADLESS=1` forçam headless e desligam `slowMo`.

## Executar

```bash
# Na raiz do repositório (credenciais obrigatórias)
set TOUR_LOGIN_PASS=sua_senha
npm run tour-visual

# A partir de mdoctor-panel
npm run tour-visual

# CI / headless
npm run tour-visual-ci
# ou: set HEADLESS=1 && npm run tour-visual
```

Variáveis úteis: `PANEL_URL`, `BACKEND_URL`, `TOUR_LOGIN_USER`, `ATENDIMENTO_ID`, `SLOW_MO`.

## Onde ficam os artefatos

| Tipo | Caminho |
|------|---------|
| Screenshots numerados do tour | `docs/screenshots/painel-tour/` |
| Network log | `docs/screenshots/painel-tour/network-log.json` |
| Console log | `docs/screenshots/painel-tour/console-log.json` |
| Traces, vídeos, screenshots automáticos | `docs/playwright-artifacts/test-results/` |
| Relatório HTML | `docs/playwright-artifacts/html-report/index.html` |
| Relatório markdown | `docs/PAINEL-TOUR-VISUAL-RELATORIO.md` |

## Trace Viewer e relatório HTML

```bash
# Abrir trace de uma execução (caminho impresso no terminal / relatório)
npm run tour-trace -- docs/playwright-artifacts/test-results/.../trace.zip

# Relatório HTML agregado
npm run tour-report
```

## Extensão Playwright no VS Code / Cursor

O spec `e2e/painel-tour.spec.ts` aparece na sidebar **Testing** com a mesma config (headed, trace, vídeo).
