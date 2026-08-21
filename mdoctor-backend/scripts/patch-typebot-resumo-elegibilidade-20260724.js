/**
 * Correção isolada no Typebot oficial (doctor-prescreve-8rmljgu), pedida por
 * Dr. Max em 24/07/2026: reformata exclusivamente as mensagens de
 * "Conferência dos dados" (grupo wupo36l29a2x66rh0bwf5yex) e "Critérios de
 * elegibilidade" (grupo fni2p22kfg51hs6s6lhcteec) em template numerado com
 * emojis, com os valores respondidos pelo paciente em negrito nativo do
 * WhatsApp (*texto*), usando a mesma técnica de QUESTION_MERGE_INPUT_IDS do
 * commit fa58f27 para unir pergunta+botões em uma única mensagem.
 *
 * Critérios de elegibilidade: os 8 critérios são preservados PALAVRA POR
 * PALAVRA e na MESMA ORDEM já publicada (apenas reorganizados com números
 * emoji e linha em branco entre itens) — nenhum critério foi reescrito,
 * resumido ou reordenado, conforme instrução explícita de não alterar seu
 * conteúdo.
 *
 * Não altera nenhuma outra pergunta, grupo, variável, edge ou roteamento.
 */
require('./load-dotenv');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const TYPEBOT_ID = 'higij2z0xihxxkr378rmljgu';
const STAMP = '20260724-resumo-elegibilidade';

const report = { fixed: [], notes: [], assertions: [] };
function check(name, ok, detail) {
  report.assertions.push({ name, ok: Boolean(ok), detail: detail === undefined ? null : detail });
  if (!ok) throw new Error(`ASSERTION FALHOU: ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`);
}
function findGroup(t, id) { const g = t.groups.find((x) => x.id === id); if (!g) throw new Error('grupo não encontrado: ' + id); return g; }
function findBlock(g, id) { const b = g.blocks.find((x) => x.id === id); if (!b) throw new Error(`bloco não encontrado: ${id} em ${g.id}`); return b; }
function blockText(b) { return (b.content.richText || []).map((p) => (p.children || []).map((c) => c.text || '').join('')).join('\n'); }
function p(id, text) { return { id, type: 'p', children: [{ text }] }; }

(async () => {
  const token = process.env.TYPEBOT_TOKEN || process.env.TYPEBOT_API_TOKEN;
  if (!token) throw new Error('TYPEBOT_TOKEN ou TYPEBOT_API_TOKEN ausente');
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  const g0 = await fetch(`https://app.typebot.com/api/v1/typebots/${TYPEBOT_ID}`, { headers: H });
  console.log('GET antes HTTP', g0.status);
  if (g0.status !== 200) throw new Error(await g0.text());
  const before = await g0.json();
  fs.writeFileSync(path.join(ROOT, `backups/typebot-doctor-prescreve-antes-${STAMP}.json`), JSON.stringify(before, null, 2));

  const t = JSON.parse(JSON.stringify(before.typebot));

  function findDangling(bot) {
    const blockIds = new Set(); bot.groups.forEach((g) => g.blocks.forEach((b) => blockIds.add(b.id)));
    const groupIds = new Set(bot.groups.map((g) => g.id));
    return bot.edges.filter((e) => {
      const fromOk = e.from.blockId ? blockIds.has(e.from.blockId) : true;
      const toOk = (e.to.groupId ? groupIds.has(e.to.groupId) : true) && (e.to.blockId ? blockIds.has(e.to.blockId) : true);
      return !fromOk || !toOk;
    }).map((e) => e.id);
  }
  const danglingBefore = findDangling(before.typebot);

  // =====================================================================
  // Pré-condições
  // =====================================================================
  const gResumo = findGroup(t, 'wupo36l29a2x66rh0bwf5yex');
  const gElig = findGroup(t, 'fni2p22kfg51hs6s6lhcteec');
  const blkCondicoes = findBlock(gResumo, 'blk_resumo_set_condicoes');
  const blkMeds = findBlock(gResumo, 'blk_resumo_set_medicamentos');
  const blkCpfMask = findBlock(gResumo, 'blk_resumo_set_cpf_mascarado');
  const blkResumoTexto = findBlock(gResumo, 'k0i76xzc7cs84de90o94oy9i');
  const blkResumoChoice = findBlock(gResumo, 'plhspmybxbhylbfbsvqyhlmj');
  const blkEligTexto = findBlock(gElig, 'iw6zqwf26frmqnp1csxiwlbm');
  const blkEligChoice = findBlock(gElig, 'w9v6g0rlkucnfmxc3qh2a2qt');

  check('pré-condição: choice resumo com 2 itens preservados (values/edges)',
    blkResumoChoice.items.length === 2 &&
    blkResumoChoice.items[0].value === 'true' && blkResumoChoice.items[0].outgoingEdgeId === 'edge_confirm_to_webhook' &&
    blkResumoChoice.items[1].value === 'false' && blkResumoChoice.items[1].outgoingEdgeId === 'edge_confirm_to_correction_menu');
  check('pré-condição: choice elegibilidade com 2 itens preservados (values/edges)',
    blkEligChoice.items.length === 2 &&
    blkEligChoice.items[0].value === 'true' && blkEligChoice.items[0].outgoingEdgeId === 'sozjhxmnxly3ybh3jju1awa1' &&
    blkEligChoice.items[1].value === 'false' && blkEligChoice.items[1].outgoingEdgeId === 'obe3sg61navcvru4wpy68uan');

  // Texto original dos 8 critérios (fonte de verdade a preservar palavra por
  // palavra — extraído do próprio bloco publicado, não digitado à mão).
  // Script idempotente: se o bloco já foi migrado para o novo template
  // (execução anterior), extrai os critérios do formato novo (linhas
  // "N️⃣ texto") em vez do formato antigo (um único parágrafo com "•").
  const emojiDigitsAll = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣'];
  const p_decl_4 = blkEligTexto.content.richText.find((x) => x.id === 'p_decl_4');
  let eligCriteria;
  if (p_decl_4) {
    const eligOriginalParagraph = (p_decl_4.children[0].text) || '';
    eligCriteria = eligOriginalParagraph.split('\n').map((s) => s.replace(/^•\s*/, '').trim()).filter(Boolean);
  } else {
    eligCriteria = blkEligTexto.content.richText
      .map((x) => (x.children || []).map((c) => c.text || '').join(''))
      .filter((text) => emojiDigitsAll.some((e) => text.startsWith(e)))
      .map((text) => text.replace(/^[\d️⃣]+\s*/, '').trim());
  }
  check('pré-condição: exatamente 8 critérios extraídos do bloco publicado', eligCriteria.length === 8, eligCriteria);

  // =====================================================================
  // 1) blk_resumo_set_condicoes: uma condição por linha, cada linha em negrito
  // =====================================================================
  blkCondicoes.options.expressionToEvaluate =
    'const raw = {{doenca_cronica}};\n' +
    'if (!raw) return "—";\n' +
    'const map = {\n' +
    '  has: "Hipertensão arterial",\n' +
    '  dm: "Diabetes mellitus",\n' +
    '  dlp: "Dislipidemia",\n' +
    '  hipotireoidismo: "Hipotireoidismo"\n' +
    '};\n' +
    'const parts = String(raw)\n' +
    '  .replace(/[\\[\\]"]/g, "")\n' +
    '  .split(",")\n' +
    '  .map((item) => item.trim().toLowerCase())\n' +
    '  .filter(Boolean);\n' +
    'const labels = parts.map((item) => map[item] || item);\n' +
    'return labels.length ? labels.map((l) => "*" + l + "*").join("\\n") : "—";';

  // =====================================================================
  // 2) blk_resumo_set_medicamentos: sem numeração, cada linha em negrito
  // =====================================================================
  blkMeds.options.expressionToEvaluate =
    'const count = Math.min(3, Math.max(1, Number({{medication_count}}) || 1));\n' +
    'const meds = [\n' +
    '  { nome: {{med1_nome}}, dose: {{med1_dose}}, freq: {{med1_frequencia}}, via: {{med1_via}} },\n' +
    '  { nome: {{med2_nome}}, dose: {{med2_dose}}, freq: {{med2_frequencia}}, via: {{med2_via}} },\n' +
    '  { nome: {{med3_nome}}, dose: {{med3_dose}}, freq: {{med3_frequencia}}, via: {{med3_via}} }\n' +
    '];\n' +
    'const lines = [];\n' +
    'for (let i = 0; i < count; i++) {\n' +
    '  const m = meds[i];\n' +
    '  if (!m.nome) continue;\n' +
    '  const parts = [m.nome];\n' +
    '  if (m.dose) parts.push(m.dose);\n' +
    '  if (m.freq) parts.push(m.freq);\n' +
    '  if (m.via) parts.push(m.via);\n' +
    '  lines.push("*" + parts.join(" — ") + "*");\n' +
    '}\n' +
    'return lines.length ? lines.join("\\n") : "—";';

  report.fixed.push('blk_resumo_set_condicoes: agora retorna uma condição por linha (\\n), cada linha entre asteriscos (negrito WhatsApp), em vez de lista única separada por vírgula.');
  report.fixed.push('blk_resumo_set_medicamentos: removida a numeração "1.", "2." — cada linha de medicamento (nome — dose — freq — via) entre asteriscos (negrito WhatsApp).');

  // =====================================================================
  // 2b) blk_resumo_set_cpf_mascarado: troca o caractere de máscara de "*"
  //     para "•" — bug encontrado ao testar ao vivo: a máscara antiga
  //     (529.***.***-25) usava asteriscos literais que, ao serem envolvidos
  //     pelo negrito novo (*{{resumo_cpf_mascarado}}*), formam sequências
  //     "***" que o próprio Typebot interpreta como marcação markdown
  //     bold+italic e SUPRIME os dígitos mascarados na mensagem final
  //     (observado ao vivo: "529.***.***-25" virou "529..-25"). Corrigido na
  //     causa raiz: a máscara passa a usar "•", que não colide com nenhuma
  //     marcação do WhatsApp/Typebot (*, _, ~, `).
  // =====================================================================
  blkCpfMask.options.expressionToEvaluate =
    'const cpf = String({{cpf_paciente}} || "").replace(/\\D/g, "");\n' +
    'if (cpf.length !== 11) return "—";\n' +
    'return cpf.slice(0, 3) + ".•••.•••-" + cpf.slice(9, 11);';
  report.fixed.push('blk_resumo_set_cpf_mascarado: caractere de máscara trocado de "*" para "•" (bug de colisão com negrito markdown corrigido — causa raiz, não workaround).');

  // =====================================================================
  // 3) Texto "Confirmação de dados" (k0i76xzc7cs84de90o94oy9i): novo template
  // =====================================================================
  blkResumoTexto.content.richText = [
    p('p_confirm_title', 'CONFIRA SEUS DADOS'),
    p('p_confirm_b0', ''),
    p('p_confirm_l1l', '1️⃣ Nome completo:'),
    p('p_confirm_l1v', '*{{Nome_Completo}}*'),
    p('p_confirm_b1', ''),
    p('p_confirm_l2l', '2️⃣ Nome social:'),
    p('p_confirm_l2v', '*{{nome_social}}*'),
    p('p_confirm_b2', ''),
    p('p_confirm_l3l', '3️⃣ Data de nascimento:'),
    p('p_confirm_l3v', '*{{data_nascimento}}*'),
    p('p_confirm_b3', ''),
    p('p_confirm_l4l', '4️⃣ CPF:'),
    p('p_confirm_l4v', '*{{resumo_cpf_mascarado}}*'),
    p('p_confirm_b4', ''),
    p('p_confirm_l5l', '5️⃣ WhatsApp:'),
    p('p_confirm_l5v', '*{{whatsapp}}*'),
    p('p_confirm_b5', ''),
    p('p_confirm_l6l', '6️⃣ E-mail:'),
    p('p_confirm_l6v', '*{{Email}}*'),
    p('p_confirm_b6', ''),
    p('p_confirm_l7l', '7️⃣ CEP:'),
    p('p_confirm_l7v', '*{{cep}}*'),
    p('p_confirm_b7', ''),
    p('p_confirm_l8l', '8️⃣ Endereço:'),
    p('p_confirm_l8v', '*{{Endereco}}*'),
    p('p_confirm_b8', ''),
    p('p_confirm_l9l', '9️⃣ Condições clínicas:'),
    p('p_confirm_l9v', '{{resumo_condicoes}}'),
    p('p_confirm_b9', ''),
    p('p_confirm_l10l', '🔟 Medicamentos:'),
    p('p_confirm_l10v', '{{resumo_medicamentos}}'),
    p('p_confirm_b10', ''),
    p('p_confirm_question', 'Os dados estão corretos?')
  ];
  report.fixed.push('k0i76xzc7cs84de90o94oy9i (texto "Confira seus dados"): reformatado em template numerado com emojis 1️⃣-🔟, uma linha em branco entre campos, somente os valores do paciente em negrito (*texto*); campo CPF usa {{resumo_cpf_mascarado}} (mascaramento agora com "•", ex.: 529.•••.•••-25); campos de condições e medicamentos usam as variáveis já calculadas (agora multi-linha e em negrito).');

  // =====================================================================
  // 4) Texto "Declaração de elegibilidade" (iw6zqwf26frmqnp1csxiwlbm): novo
  //    template, mesmos 8 critérios, mesma ordem, mesma redação.
  // =====================================================================
  const eligParas = [p('p_decl_title', 'CRITÉRIOS DE ELEGIBILIDADE'), p('p_decl_b0', ''), p('p_decl_intro', 'Para continuar, confirme que:'), p('p_decl_b1', '')];
  const emojiDigits = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣'];
  eligCriteria.forEach((criterion, idx) => {
    eligParas.push(p(`p_decl_c${idx + 1}`, `${emojiDigits[idx]} ${criterion}`));
    eligParas.push(p(`p_decl_cb${idx + 1}`, ''));
  });
  eligParas.push(p('p_decl_question', 'Você confirma essas informações?'));
  blkEligTexto.content.richText = eligParas;
  report.fixed.push('iw6zqwf26frmqnp1csxiwlbm (texto "Critérios de elegibilidade"): reformatado em template numerado com emojis 1️⃣-8️⃣, uma linha em branco entre critérios; os 8 critérios preservados palavra por palavra e na mesma ordem já publicada (extraídos do próprio bloco original, não redigitados).');

  // =====================================================================
  // 5) Bridge: extensão do QUESTION_MERGE_INPUT_IDS acontece em código
  //    (typebot-whatsapp.bridge.js), fora deste patch — apenas documentado
  //    aqui para rastreabilidade do pedido.
  // =====================================================================
  report.notes.push('QUESTION_MERGE_INPUT_IDS (mdoctor-backend/src/services/typebot-whatsapp.bridge.js) recebe plhspmybxbhylbfbsvqyhlmj e w9v6g0rlkucnfmxc3qh2a2qt nesta mesma pedido, em commit único — mesma técnica do fa58f27.');

  // =====================================================================
  // VALIDAÇÕES FINAIS
  // =====================================================================
  const resumoTextoFinal = blockText(blkResumoTexto);
  const eligTextoFinal = blockText(blkEligTexto);
  check('resumo: 10 campos numerados presentes (1️⃣..🔟)', ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'].every((e) => resumoTextoFinal.includes(e)));
  check('resumo: pergunta final presente uma única vez', (resumoTextoFinal.match(/Os dados estão corretos\?/g) || []).length === 1);
  check('resumo: não contém "Receita anterior"', !/Receita anterior/i.test(resumoTextoFinal));
  check('resumo: máscara de CPF não usa mais asterisco literal (evita colisão com negrito markdown)', !blkCpfMask.options.expressionToEvaluate.includes('*'));
  check('elegibilidade: 8 critérios numerados presentes (1️⃣..8️⃣)', emojiDigits.every((e) => eligTextoFinal.includes(e)));
  check('elegibilidade: todos os 8 critérios originais presentes literalmente', eligCriteria.every((c) => eligTextoFinal.includes(c)));
  check('elegibilidade: pergunta final presente uma única vez', (eligTextoFinal.match(/Você confirma essas informações\?/g) || []).length === 1);
  check('choice resumo inalterado (values/edges/labels)',
    JSON.stringify(blkResumoChoice.items) === JSON.stringify(before.typebot.groups.find((g) => g.id === 'wupo36l29a2x66rh0bwf5yex').blocks.find((b) => b.id === 'plhspmybxbhylbfbsvqyhlmj').items));
  check('choice elegibilidade inalterado (values/edges/labels)',
    JSON.stringify(blkEligChoice.items) === JSON.stringify(before.typebot.groups.find((g) => g.id === 'fni2p22kfg51hs6s6lhcteec').blocks.find((b) => b.id === 'w9v6g0rlkucnfmxc3qh2a2qt').items));

  const danglingAfter = findDangling(t);
  const newDangling = danglingAfter.filter((id) => !danglingBefore.includes(id));
  check('V. nenhuma edge nova quebrada', newDangling.length === 0, { preExistentes: danglingBefore, novas: newDangling });

  console.log('\n=== CORRIGIDO ===');
  report.fixed.forEach((x) => console.log(' -', x));
  console.log('=== NOTAS ===');
  report.notes.forEach((x) => console.log(' -', x));
  console.log('Assertions:', report.assertions.filter((a) => a.ok === true).length, '/', report.assertions.length, 'OK');

  const patch = await fetch(`https://app.typebot.com/api/v1/typebots/${TYPEBOT_ID}`, {
    method: 'PATCH', headers: H,
    body: JSON.stringify({ typebot: { version: t.version, groups: t.groups, edges: t.edges, variables: t.variables }, overwrite: true })
  });
  console.log('PATCH HTTP', patch.status);
  if (patch.status !== 200) { console.log((await patch.text()).slice(0, 2000)); process.exit(1); }

  const pub = await fetch(`https://app.typebot.com/api/v1/typebots/${TYPEBOT_ID}/publish`, { method: 'POST', headers: H });
  console.log('PUBLISH HTTP', pub.status);
  if (pub.status !== 200) { console.log((await pub.text()).slice(0, 2000)); process.exit(1); }

  const g1 = await fetch(`https://app.typebot.com/api/v1/typebots/${TYPEBOT_ID}`, { headers: H });
  console.log('GET depois HTTP', g1.status);
  const after = await g1.json();
  fs.writeFileSync(path.join(ROOT, `backups/typebot-doctor-prescreve-depois-${STAMP}.json`), JSON.stringify(after, null, 2));
  fs.writeFileSync(path.join(ROOT, `backups/typebot-patch-resumo-elegibilidade-report-${STAMP}.json`), JSON.stringify(report, null, 2));

  console.log('\nOK — publicado.');
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
