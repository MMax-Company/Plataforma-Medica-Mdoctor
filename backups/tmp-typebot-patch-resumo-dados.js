/**
 * Ajuste do bloco Resumo dos dados no Typebot homologado.
 * Reaplicável via TYPEBOT_API_TOKEN.
 */
const fs = require('fs');
const { patchResumoDados, IDS } = require('../mdoctor-backend/scripts/patch-typebot-resumo-dados');

const TYPEBOT_ID = 'higij2z0xihxxkr378rmljgu';

(async () => {
  const token = String(process.env.TYPEBOT_API_TOKEN || process.env.TYPEBOT_TOKEN || '').trim();
  if (!token) throw new Error('TYPEBOT_API_TOKEN ou TYPEBOT_TOKEN ausente');

  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').slice(0, 12);
  const g0 = await fetch(`https://app.typebot.io/api/v1/typebots/${TYPEBOT_ID}`, { headers: H });
  console.log('GET antes HTTP', g0.status);
  if (!g0.ok) throw new Error('GET falhou: ' + (await g0.text()).slice(0, 400));
  const before = await g0.json();
  fs.writeFileSync(`backups/typebot-doctor-prescreve-antes-resumo-${stamp}.json`, JSON.stringify(before, null, 2));

  const t = JSON.parse(JSON.stringify(before.typebot));
  patchResumoDados(t);

  const patch = await fetch(`https://app.typebot.io/api/v1/typebots/${TYPEBOT_ID}`, {
    method: 'PATCH',
    headers: H,
    body: JSON.stringify({ typebot: { version: t.version, groups: t.groups, edges: t.edges, variables: t.variables }, overwrite: true })
  });
  console.log('PATCH HTTP', patch.status);
  if (!patch.ok) {
    console.log((await patch.text()).slice(0, 800));
    process.exit(1);
  }

  const pub = await fetch(`https://app.typebot.io/api/v1/typebots/${TYPEBOT_ID}/publish`, { method: 'POST', headers: H });
  console.log('PUBLISH HTTP', pub.status);
  if (!pub.ok) {
    console.log((await pub.text()).slice(0, 800));
    process.exit(1);
  }

  const g1 = await fetch(`https://app.typebot.io/api/v1/typebots/${TYPEBOT_ID}`, { headers: H });
  const after = await g1.json();
  fs.writeFileSync(`backups/typebot-doctor-prescreve-depois-resumo-${stamp}.json`, JSON.stringify(after, null, 2));

  const check = JSON.stringify(after.typebot);
  console.log('grupo ok:', after.typebot.groups.some((g) => g.id === IDS.grpResumo && g.title === 'Resumo dos dados'));
  console.log('opcoes ok:', check.includes('Sim, confirmar e continuar') && check.includes('Corrigir dados pessoais'));
  console.log('rota correcao ok:', check.includes('edge_dados_to_resumo') && check.includes('edge_resumo_to_medcount'));
})().catch((error) => {
  console.error('ERRO', error.message);
  process.exit(1);
});
