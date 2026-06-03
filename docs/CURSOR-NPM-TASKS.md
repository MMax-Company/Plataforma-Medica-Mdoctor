# Cursor — erro “Detecção de tarefa NPM: falha ao analisar package.json”

O `package.json` da raiz é **JSON válido**. No Cursor, essa mensagem costuma aparecer quando a extensão NPM **não consegue abrir/ler o arquivo** (OneDrive, pasta com acento em `Área de Trabalho`, corrida de leitura) — não porque o JSON esteja errado.

## Correção aplicada no repositório

1. **`npm.autoDetect": "off"`** em `.vscode/settings.json` — desliga o scanner que dispara o toast.
2. **Tarefas manuais** em `.vscode/tasks.json` — `Terminal` → `Run Task…` → ex.: `tour visual (Playwright)`.
3. **`Mdoctor-Survive.code-workspace`** — abrir o projeto por este arquivo também aplica `npm.autoDetect: off`.

## Se o toast continuar após Reload Window

Aplique no **User** settings (`Ctrl+,` → ícone `{}`):

```json
{
  "npm.autoDetect": "off"
}
```

Ou abra a pasta pelo arquivo de workspace:

`File` → `Open Workspace from File…` → `Mdoctor-Survive.code-workspace`

## Scripts (terminal — sempre funcionam)

```powershell
npm run dev-all
npm run tour-visual
npm run tour-visual-ci
```

## Evitar que o erro volte

- Não salvar `package.json` com **UTF-8 BOM** (evite `Set-Content -Encoding utf8` no PowerShell).
- Feche a aba `package.json` se estiver com alterações não salvas inválidas.
- Prefira manter o projeto **sincronizado localmente** no OneDrive (não “somente online”).
