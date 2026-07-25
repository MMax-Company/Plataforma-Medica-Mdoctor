# memed-react — API pública de MdHub/MdSinapsePrescricao e capacidades de customização

Levantamento do código-fonte de [`simvini/memed-react`](https://github.com/simvini/memed-react)
(TypeScript, licença MIT, 31★, criado em jan/2021, **último push em 30/11/2021**),
a mesma biblioteca de referência já citada em `docs/MEMED-REACT-ALIGNMENT.md`
(lá referenciada pelo fork `devisales/memed-react` — mesmo conteúdo/arquitetura).

Objetivo deste documento: mapear **todos os métodos públicos** expostos por
`MdHub` e `MdSinapsePrescricao` (via o wrapper) e verificar se existe suporte
oficial para customização visual (tema, cores, fontes, CSS, layout do módulo
ou do PDF da receita). **Somente levantamento — nenhuma alteração de código
foi feita.**

## ⚠️ Natureza da biblioteca (importante para interpretar o que segue)

- É um wrapper **não oficial**, mantido pela comunidade — o próprio README
  declara: *"A empresa Memed não é responsável por atualizações dessa
  biblioteca. Qualquer atualização da lib principal que possa quebrar a
  execução dessa biblioteca é de minha responsabilidade e dos
  colaboradores."*
- Está **desatualizada em relação ao que o Doctor Prescreve já usa em
  produção**: o wrapper só tipa `setPaciente` e `setFeatureToggle`, mas o
  nosso próprio código (`mdoctor-panel/src/lib/memed/*`) já chama com sucesso
  `addItem`, `newPrescription` e escuta `prescricaoGerada`/`prescricaoExcluida`
  — comandos/eventos reais do script `sinapse-prescricao.min.js` da Memed que
  **não estão documentados nesta lib**. Ou seja: a superfície real do script
  da Memed é maior do que a exposta por este wrapper; o wrapper só tipa o
  subconjunto que o autor usou.
- Conclusão prática: esta lib **não é a fonte de verdade completa** da API da
  Memed — é uma referência de arquitetura/padrão de uso (por isso
  `MEMED-REACT-ALIGNMENT.md` a cita como "fluxo oficial (único)" de como
  *estruturar* a integração, não como spec completa de comandos).

## `MdHub` — interface pública (`src/domain/MdHub.ts`)

```ts
export interface MdHub {
  server: {
    unbindEvents: () => void
  }
  command: {
    send: (moduleName: string, action: string, payload?: Patient | unknown) => Promise<void>
    deletePatient: unknown | boolean
    removePatient: unknown | boolean
    editPatient: unknown | boolean
  }
  module: Module
  event: {
    add(name: string, handler: (...args: unknown[]) => void): void
  }
}
```

| Membro | Assinatura | Uso observado (na lib e/ou no nosso código) |
|---|---|---|
| `MdHub.server.unbindEvents()` | `() => void` | Chamado no `cleanUp` (logout/desmontagem) |
| `MdHub.command.send(moduleName, action, payload?)` | genérico, retorna `Promise<void>` | Canal único para **todos** os comandos: `setFeatureToggle`, `setPaciente`, `addItem` (usado por nós), `newPrescription` (usado por nós), `logout` (`plataforma.sdk`) |
| `MdHub.command.deletePatient` / `.removePatient` / `.editPatient` | tipados como `unknown \| boolean` | Não documentados como função nem como flag — provavelmente vestígio/placeholder da lib, não usados nem por ela mesma (o controle real é via `setFeatureToggle`, abaixo) |
| `MdHub.module.show(moduleName)` | `(module: string) => void` | Exibe o módulo (`plataforma.prescricao`) |
| `MdHub.module.hide(moduleName)` | `(module: string) => void` | Oculta o módulo |
| `MdHub.module.name` | `string` | Nome do módulo corrente |
| `MdHub.event.add(name, handler)` | genérico | Assina eventos: `prescricaoImpressa` (a lib), e no nosso código também `prescricaoGerada`, `prescricaoExcluida` |

### Comandos conhecidos via `command.send('plataforma.prescricao', <action>, payload)`

Extraídos do próprio wrapper + do nosso uso real (não existe uma lista fechada/oficial — é descoberta empírica):

| Action | Payload | Origem |
|---|---|---|
| `setFeatureToggle` | `{ deletePatient: false, removePatient: false, editPatient: false }` | `disableSensitiveCommands.ts` — desativa edição/remoção de paciente pelo médico dentro do widget (parte da homologação) |
| `setPaciente` | `{ nome, endereco, cidade, telefone, peso?, altura?, idExterno }` | `setMemedPatient.ts` |
| `addItem` | `{ nome, posologia, quantidade? }` | **Não documentado na lib** — usado pelo Doctor Prescreve (`memedCommandDiagnostic.ts`) |
| `newPrescription` | sem payload | **Não documentado na lib** — usado pelo Doctor Prescreve para resetar o formulário em P2+ |
| `logout` (módulo `plataforma.sdk`, não `plataforma.prescricao`) | — | `cleanUp.ts` |

### Eventos conhecidos via `MdHub.event.add`

| Evento | Quando dispara | Payload relevante |
|---|---|---|
| `prescricaoImpressa` | Receita impressa/assinada | Dados da prescrição (usado para `onPrescriptionPrinted`) — no nosso código, parseado por `parsePrescriptionPayload.ts` para extrair `id`, `pdf_url`, `digital_link`, `unlock_code`. **Não inclui dados dos medicamentos como o catálogo os reconheceu** — só metadados do documento gerado |
| `prescricaoGerada` | Antes de `window.print()` (não documentado na lib, descoberto pelo nosso time) | Similar a `prescricaoImpressa`, às vezes com payload parcial |
| `prescricaoExcluida` | Receita excluída no widget (não documentado na lib) | — |

## `MdSinapsePrescricao` — interface pública (`src/domain/MdSinapsePrescricao.ts`)

```ts
export interface MdSinapsePrescricao {
  setToken: (token: string) => void
  event: {
    add(module: string, handler: (module: Module) => void): void
  }
}
```

| Membro | Uso |
|---|---|
| `MdSinapsePrescricao.setToken(token)` | Não é chamado diretamente pelo wrapper (o token vai via atributo `data-token` do `<script>`, ver abaixo) — existe na interface mas não há exemplo de uso direto no próprio repo |
| `MdSinapsePrescricao.event.add('core:moduleInit', handler)` | Único uso real na lib (`onLoadPrescription.ts`) — dispara quando o módulo termina de inicializar; o handler recebe um `Module { name, show, hide }` e a lib verifica `modulo.name === 'plataforma.prescricao'` para marcar `prescriptionLoaded = true` |

`Module` (`src/domain/Module.ts`):
```ts
export interface Module {
  name: string
  show: (module: string) => void
  hide: (module: string) => void
}
```

## Configuração exposta pelo wrapper React (não é a API crua da Memed, é a camada de conveniência)

### `MemedProvider` props (`src/providers/MemedProvider.tsx`)

| Prop | Default | Efeito |
|---|---|---|
| `color` | `'#00B8D6'` | Vira o atributo `data-color` do `<script>` injetado — **única customização visual documentada, ver seção abaixo** |
| `scriptSrc` | URL de sandbox da Memed | Alterna sandbox/produção |
| `scriptId` | `'memedScript'` | id do elemento `<script>` no DOM |

### `ModuleOptions` (via `useMemed(options)` ou `setOptions`)

```ts
export interface ModuleOptions {
  onPrescriptionPrinted: (prescriptionData: unknown) => void
}
```

Único callback tipado pela lib — internamente vira `MdHub.event.add('prescricaoImpressa', onPrescriptionPrinted)`.

### Funções do hook `useMemed()`

`setDoctorToken`, `setPatient`, `setActionRef`, `setOptions`, `onLogout`,
`showPrescription`, `hidePrescription`, `loadingModule` (boolean derivado de
`prescriptionLoaded && patientSet`).

## Customização visual — resultado da verificação

**Não existe suporte oficial, documentado ou usado por esta lib, para alterar
tema, cores (além de uma cor única), fontes, CSS, layout do módulo ou layout
do PDF da receita.** Detalhamento:

| Item pedido | Suporte encontrado |
|---|---|
| **Tema** (claro/escuro, esquema completo) | ❌ Nenhum. Não há prop, comando ou opção de tema |
| **Cores** | ⚠️ Parcial: **uma única cor de destaque**, via `data-color` no `<script>` (prop `color` do `MemedProvider`, default `#00B8D6`). É aplicada uma vez na criação do script — não é uma API de runtime, não há paleta, não há cor secundária/de fundo/de texto separadas |
| **Fontes** | ❌ Nenhuma opção. Não há prop nem atributo relacionado a tipografia |
| **CSS customizado** | ❌ Não existe mecanismo de injeção de CSS. O módulo da Memed roda dentro de **iframe cross-origin** (confirmado pelo nosso próprio código, que precisa de `sandbox` e `MutationObserver` para lidar com os iframes) — mesmo que existisse a intenção, CSS da página hospedeira não atravessa um iframe cross-origin por política do navegador |
| **Layout do módulo** (posição, tamanho, estrutura) | ❌ Nenhuma opção documentada. O único controle é `show()`/`hide()` (visibilidade), não layout. O atributo `data-container` (visto no nosso próprio `createMemedScript.ts`) não existe na lib de referência — é algo que o nosso time descobriu/usa empiricamente, mas também não é "layout customizável", só onde ancorar o container |
| **Layout/design do PDF da receita** | ❌ Nenhuma opção, em nenhum nível. A geração do PDF é 100% interna à Memed; o único dado que voltamos a receber sobre ele é a URL/link (`prescricaoImpressa` → `pdf_url`/`digital_link`), nunca controle sobre sua aparência |

### Por que essa limitação é esperada

1. A lib inteira desativa (`setFeatureToggle`) até funções sensíveis de
   edição de paciente — é um wrapper propositalmente restrito ao mínimo para
   homologação, não uma API de customização.
2. O módulo é servido pela Memed dentro de iframe cross-origin — qualquer
   customização visual profunda exigiria suporte explícito do lado da Memed
   (ex.: um postMessage API para tema), que não existe nesta lib nem foi
   referenciado em nenhum outro doc `MEMED-*.md` deste projeto.
3. A única "porta" de customização (`data-color`) é consistente com o padrão
   comum de widgets embutidos de terceiros: uma cor de marca simples, não uma
   API de theming.

## O que o Doctor Prescreve já usa hoje (para contexto, sem alteração)

`mdoctor-panel/src/lib/memed/createMemedScript.ts` já usa a única
customização disponível: `data-color` = `primaryColor` (`'#1557FF'` por
padrão, configurável via `memedConfig.primaryColor`/env). Não há, e não
haveria como haver, nada além disso sendo usado — está alinhado ao teto real
da API.

## Conclusão

Não implementar tentativas de tema/CSS/fonte/layout de módulo ou PDF — não
existe API pública (nem na lib de referência, nem em nenhum artefato deste
repositório) para isso. A única alavanca visual real é a cor única via
`data-color`, já em uso. Qualquer necessidade de branding mais profundo
exigiria abertura de solicitação junto à Memed diretamente (fora do escopo
de código deste projeto).
