/**
 * Corrige apenas o bloco 13 — Telemedicina e não urgência no Typebot Doctor Prescreve.
 *
 * - Substitui "teleconsulta" por telemedicina assíncrona
 * - Informa análise médica posterior e possíveis desfechos da solicitação
 * - Mantém títulos de documentos separados dos links
 * - Opções: "Li, estou ciente e desejo continuar" / "Não desejo continuar"
 * - Não altera variáveis, rotas ou integrações
 *
 * Uso:
 *   node patch-typebot-telemedicina.js --local   # atualiza exports JSON no repo
 *   TYPEBOT_API_TOKEN=*** node patch-typebot-telemedicina.js
 */
const fs = require('fs');
const path = require('path');

const TYPEBOT_ID = 'higij2z0xihxxkr378rmljgu';
const GROUP_TELE_ID = 'grp_telemedicina_consent';
const INTRO_BLOCK_ID = 'blk_tele_intro';
const DOCS_BLOCK_ID = 'blk_tele_docs';
const CHOICE_BLOCK_ID = 'blk_tele_choice';
const VAR_TELEMEDICINE = 'var_678up7nr';
const CHOICE_ACCEPT = 'Li, estou ciente e desejo continuar';
const CHOICE_DECLINE = 'Não desejo continuar';

const INTRO_PARAGRAPHS = [
  'Este atendimento é realizado por telemedicina assíncrona para avaliação de renovação de receita. Não substitui atendimento presencial em casos de urgência ou emergência.',
  'Após o envio das informações e documentos, um médico analisará sua solicitação posteriormente.',
  'Sua solicitação poderá ser aprovada, reprovada, devolvida para complementação ou direcionada para avaliação presencial.',
  'Leia os documentos abaixo:'
];

const LOCAL_FILES = [
  path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-homologado-20260716.json'),
  path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-production.json'),
  path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-staging-safe.json')
];

const p = (id, text) => ({ id, type: 'p', children: [{ text }] });

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function extractDocLinks(richText) {
  const links = [];
  for (const node of richText || []) {
    if (node.type !== 'p') continue;
    const anchor = (node.children || []).find((c) => c.type === 'a' && c.url);
    if (!anchor) continue;
    const label = (anchor.children || []).map((c) => c.text || '').join('');
    links.push({ url: anchor.url, label });
  }
  return links;
}

function buildDocRichText(links) {
  return links.map((link, index) => ({
    id: `p_tele_doc_${index}`,
    type: 'p',
    children: [
      { text: '📄 ' },
      {
        url: link.url,
        type: 'a',
        target: '_blank',
        children: [{ text: link.label }]
      }
    ]
  }));
}

function applyTelemedicinaPatch(typebot) {
  const t = clone(typebot);
  const group = t.groups.find((g) => g.id === GROUP_TELE_ID);
  if (!group) throw new Error('grupo Telemedicina e não urgência não encontrado');

  const intro = group.blocks.find((b) => b.id === INTRO_BLOCK_ID);
  if (!intro || intro.type !== 'text') throw new Error('bloco intro telemedicina não encontrado');
  intro.content.richText = INTRO_PARAGRAPHS.map((text, index) => p(`p_tele_intro_${index}`, text));

  const docs = group.blocks.find((b) => b.id === DOCS_BLOCK_ID);
  if (!docs || docs.type !== 'text') throw new Error('bloco docs telemedicina não encontrado');
  const existingLinks = extractDocLinks(docs.content.richText);
  if (existingLinks.length < 2) {
    throw new Error('links de documentos telemedicina incompletos');
  }
  docs.content.richText = buildDocRichText(existingLinks);

  const choice = group.blocks.find((b) => b.id === CHOICE_BLOCK_ID);
  if (!choice || choice.type !== 'choice input') throw new Error('choice input telemedicina não encontrado');
  if (choice.options?.variableId !== VAR_TELEMEDICINE) {
    throw new Error('variableId telemedicine_consent_accepted inesperado');
  }

  const accept = choice.items.find((i) => i.id === 'tele_sim');
  const decline = choice.items.find((i) => i.id === 'tele_nao');
  if (!accept || !decline) throw new Error('itens de escolha telemedicina não encontrados');
  accept.content = CHOICE_ACCEPT;
  decline.content = CHOICE_DECLINE;

  if (group.blocks.length !== 3) {
    throw new Error(`grupo telemedicina com blocos inesperados: ${group.blocks.length}`);
  }

  return t;
}

function blockFingerprint(groups) {
  const map = {};
  for (const group of groups) {
    for (const block of group.blocks) map[block.id] = JSON.stringify(block);
  }
  return map;
}

function validatePatch(before, after) {
  const errors = [];
  const beforeBlocks = blockFingerprint(before.groups);
  const afterBlocks = blockFingerprint(after.groups);
  const allowedChanged = new Set([INTRO_BLOCK_ID, DOCS_BLOCK_ID, CHOICE_BLOCK_ID]);

  for (const [id, json] of Object.entries(afterBlocks)) {
    if (beforeBlocks[id] === json) continue;
    if (!allowedChanged.has(id)) errors.push('bloco alterado inesperado: ' + id);
  }

  if (JSON.stringify(before.variables) !== JSON.stringify(after.variables)) {
    errors.push('variáveis alteradas');
  }
  if (JSON.stringify(before.edges) !== JSON.stringify(after.edges)) {
    errors.push('edges alteradas');
  }

  const teleVar = after.variables.find((v) => v.id === VAR_TELEMEDICINE);
  if (!teleVar || teleVar.name !== 'telemedicine_consent_accepted') {
    errors.push('variável telemedicine_consent_accepted ausente ou renomeada');
  }

  const group = after.groups.find((g) => g.id === GROUP_TELE_ID);
  const choice = group.blocks.find((b) => b.id === CHOICE_BLOCK_ID);
  if (choice.items.find((i) => i.id === 'tele_sim')?.content !== CHOICE_ACCEPT) {
    errors.push('opção de aceite incorreta');
  }
  if (choice.items.find((i) => i.id === 'tele_nao')?.content !== CHOICE_DECLINE) {
    errors.push('opção de recusa incorreta');
  }

  const teleGroup = after.groups.find((g) => g.id === GROUP_TELE_ID);
  const teleSerialized = JSON.stringify(teleGroup);
  if (teleSerialized.includes('teleconsulta')) errors.push('texto teleconsulta ainda presente no bloco telemedicina');
  for (const paragraph of INTRO_PARAGRAPHS) {
    if (!teleSerialized.includes(paragraph)) errors.push('parágrafo ausente: ' + paragraph.slice(0, 40));
  }

  if (errors.length) throw new Error(errors.join('; '));
}

function patchLocalFiles() {
  const report = [];
  for (const file of LOCAL_FILES) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) {
      report.push({ file: resolved, skipped: true, reason: 'not found' });
      continue;
    }
    const before = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    const after = applyTelemedicinaPatch(before);
    validatePatch(before, after);
    fs.writeFileSync(resolved, JSON.stringify(after, null, 2) + '\n');
    report.push({ file: resolved, groups: after.groups.length, ok: true });
  }
  return report;
}

async function patchLiveTypebot() {
  const token = String(process.env.TYPEBOT_API_TOKEN || process.env.TYPEBOT_TOKEN || '').trim();
  if (!token) throw new Error('TYPEBOT_API_TOKEN ou TYPEBOT_TOKEN ausente');

  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').slice(0, 12);
  const backupDir = path.join(__dirname, '../../backups');
  fs.mkdirSync(backupDir, { recursive: true });

  const beforeRes = await fetch(`https://app.typebot.io/api/v1/typebots/${TYPEBOT_ID}`, { headers });
  if (!beforeRes.ok) throw new Error('GET falhou: ' + (await beforeRes.text()).slice(0, 400));
  const beforePayload = await beforeRes.json();
  fs.writeFileSync(
    path.join(backupDir, `typebot-doctor-prescreve-antes-telemedicina-${stamp}.json`),
    JSON.stringify(beforePayload, null, 2)
  );

  const before = beforePayload.typebot;
  const after = applyTelemedicinaPatch(before);
  validatePatch(before, after);

  const patchRes = await fetch(`https://app.typebot.io/api/v1/typebots/${TYPEBOT_ID}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      typebot: { version: after.version, groups: after.groups, edges: after.edges },
      overwrite: true
    })
  });
  console.log('PATCH HTTP', patchRes.status);
  if (!patchRes.ok) {
    console.log((await patchRes.text()).slice(0, 800));
    process.exit(1);
  }

  const publishRes = await fetch(`https://app.typebot.io/api/v1/typebots/${TYPEBOT_ID}/publish`, {
    method: 'POST',
    headers
  });
  console.log('PUBLISH HTTP', publishRes.status);
  if (!publishRes.ok) {
    console.log((await publishRes.text()).slice(0, 800));
    process.exit(1);
  }

  const afterRes = await fetch(`https://app.typebot.io/api/v1/typebots/${TYPEBOT_ID}`, { headers });
  if (!afterRes.ok) throw new Error('GET pós-patch falhou');
  const afterPayload = await afterRes.json();
  fs.writeFileSync(
    path.join(backupDir, `typebot-doctor-prescreve-depois-telemedicina-${stamp}.json`),
    JSON.stringify(afterPayload, null, 2)
  );

  const check = JSON.stringify(afterPayload.typebot);
  return {
    success: true,
    telemedicinaAssincronaOk: check.includes('telemedicina assíncrona'),
    medicoAnalisaraOk: check.includes('um médico analisará sua solicitação posteriormente'),
    desfechosOk: check.includes('devolvida para complementação'),
    aceiteOk: check.includes(CHOICE_ACCEPT),
    recusaOk: check.includes(CHOICE_DECLINE),
    teleconsultaRemoved: !check.includes('teleconsulta')
  };
}

(async () => {
  if (process.argv.includes('--local')) {
    const report = patchLocalFiles();
    console.log(JSON.stringify({ mode: 'local', report }, null, 2));
    return;
  }

  const token = String(process.env.TYPEBOT_API_TOKEN || process.env.TYPEBOT_TOKEN || '').trim();
  if (!token) {
    const report = patchLocalFiles();
    console.log(
      JSON.stringify(
        {
          mode: 'local-only',
          note: 'TYPEBOT_API_TOKEN ausente; exports JSON atualizados no repo',
          report
        },
        null,
        2
      )
    );
    return;
  }

  const result = await patchLiveTypebot();
  console.log(JSON.stringify(result, null, 2));
})().catch((error) => {
  console.error('ERRO', error.message);
  process.exit(1);
});
