# VS Code local dev

Abra sempre a pasta:

```text
C:\Users\drmax\OneDrive\Área de Trabalho\Mdoctor-Survive
```

O comando correto na raiz e:

```bash
npm run dev
```

Se o terminal mostrar `medico-prescreve-backend@1.0.0`, o VS Code esta rodando o projeto antigo ou subindo para outro `package.json`. O projeto oficial deve mostrar:

```text
mdoctor-survive@1.0.0
```

## Erro `postgres-*.railway.internal`

Hosts `*.railway.internal` so funcionam dentro da rede privada da Railway. Eles nao resolvem no Windows/VS Code local.

Para evitar confusao, o backend bloqueia `npm run dev` quando `mdoctor-backend/.env` contem:

- `NODE_ENV=production`;
- qualquer variavel com `.railway.internal`.

Isso protege contra usar acidentalmente credenciais/configuracao de producao em desenvolvimento local.

## Tasks prontas

No VS Code, use `Terminal > Run Task...`:

- `MDoctor: dev all`
- `MDoctor: dev backend`
- `MDoctor: repository check`
