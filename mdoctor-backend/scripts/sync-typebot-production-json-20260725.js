/**
 * Sincroniza docs/typebot/typebot-doctor-prescreve-production.json com a
 * versão atualmente publicada do Typebot oficial (higij2z0xihxxkr378rmljgu),
 * pedido por Dr. Max em 25/07/2026 logo após a correção do bloco órfão
 * (var_resumo_medicamentos). Somente leitura do Typebot — nenhuma alteração
 * de fluxo/lógica, apenas atualização do arquivo versionado no repositório.
 */
require('./load-dotenv');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const TYPEBOT_ID = 'higij2z0xihxxkr378rmljgu';
const DEST = path.join(ROOT, 'docs/typebot/typebot-doctor-prescreve-production.json');

(async () => {
  const token = process.env.TYPEBOT_TOKEN || process.env.TYPEBOT_API_TOKEN;
  if (!token) throw new Error('TYPEBOT_TOKEN ou TYPEBOT_API_TOKEN ausente');
  const H = { Authorization: 'Bearer ' + token };

  const res = await fetch(`https://app.typebot.com/api/v1/typebots/${TYPEBOT_ID}`, { headers: H });
  console.log('GET HTTP', res.status);
  if (res.status !== 200) throw new Error(await res.text());
  const data = await res.json();
  const live = data.typebot;

  const before = fs.existsSync(DEST) ? JSON.parse(fs.readFileSync(DEST, 'utf8')) : null;

  fs.writeFileSync(DEST, JSON.stringify(live, null, 2) + '\n');

  const after = JSON.parse(fs.readFileSync(DEST, 'utf8'));
  const identical = JSON.stringify(after) === JSON.stringify(live);
  console.log('Arquivo gravado. Igual byte-a-byte ao export ao vivo:', identical);

  if (before) {
    console.log('\n=== Resumo da divergência (antes -> depois) ===');
    console.log('groups:', before.groups?.length, '->', after.groups.length);
    console.log('edges:', before.edges?.length, '->', after.edges.length);
    console.log('variables:', before.variables?.length, '->', after.variables.length);
    console.log('updatedAt:', before.updatedAt, '->', after.updatedAt);
  }
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
