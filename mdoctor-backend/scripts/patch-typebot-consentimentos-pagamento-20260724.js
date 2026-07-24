/**
 * Correção isolada no Typebot oficial (doctor-prescreve-8rmljgu), pedida por
 * Dr. Max em 24/07/2026 — trecho LGPD/Privacidade → Telemedicina/Não
 * Urgência → mensagens de pagamento e recebimento da receita anterior.
 *
 * IDs exatos consultados no JSON publicado antes de qualquer alteração
 * (nenhum inventado — ver relatório de assertions no final da execução):
 *
 *   b2l6ks9gkl95zebue3wri6tr   — grupo "Consentimento LGPD"
 *     blk_lgpd_intro           — reaproveitado (texto -> Caixa 1: intro LGPD)
 *     blk_lgpd_docs            — reaproveitado (link -> Caixa 1: botão LGPD)
 *     ivbr3o1a7lv8izhfteuerhqx — choice input (reaproveitado, values corrigidos)
 *   jnbvtyzr1ffz4ff5n05a999k  — grupo de recusa LGPD ("Group #22")
 *     skre2de1bnw4113hysub3fgj — reaproveitado (texto -> mensagem oficial de recusa)
 *     kfa5kfgqdvkvttzo6xn6o8n0 — REMOVIDO (imagem quebrada, S3 do Typebot)
 *     mzwt4y2kbvuhdz7d29dtrgp2 — REMOVIDO (texto redundante)
 *   grp_lgpd_accept            — grupo "Registro LGPD" (reaproveitado)
 *     blk_set_lgpd / blk_set_privacy / blk_set_lgpd_links / blk_lgpd_accept_done
 *
 *   grp_telemedicina_consent   — grupo "Telemedicina e não urgência"
 *     blk_tele_intro           — reaproveitado (texto -> Caixa 1: intro telemedicina)
 *     blk_tele_docs            — reaproveitado (link -> Caixa 1: botão telemedicina)
 *     blk_tele_choice          — choice input (reaproveitado, values já corretos)
 *   grp_telemedicina_accept    — grupo "Registro telemedicina" (reaproveitado)
 *   grp_telemedicina_decline   — grupo "Encerramento telemedicina" (já correto,
 *                                 não alterado)
 *
 *   grp_foto_receita           — grupo "Aguardando envio da receita"
 *     blk_foto_txt             — reaproveitado (texto -> mensagem pós-pagamento)
 *
 * Diagnóstico (auditoria antes de alterar):
 * - LGPD e Telemedicina compartilhavam a mesma estrutura de 2 blocos de
 *   texto (intro+pergunta combinados; 2 links combinados no mesmo bloco) +
 *   1 choice — o bridge (typebot-whatsapp.bridge.js/convertTypebotResponse)
 *   funde o texto anterior no corpo do PRIMEIRO botão de link e usa "📄"
 *   como corpo genérico do segundo, e a pergunta real nunca aparecia junto
 *   dos botões Autorizo/Ciente (a mensagem de escolha usa corpo genérico
 *   "Escolha uma opção:", padrão de todo o bot — não alterado, fora de
 *   escopo, usado em dezenas de outros blocos já validados).
 * - values do choice de LGPD eram "sim"/"nao" — único ponto do bot que não
 *   segue a convenção "true"/"false" já usada em telemedicina, termos,
 *   elegibilidade etc. Corrigido para alinhar (mesmo padrão, mesma
 *   variável, sem novo mecanismo).
 * - grupo de recusa do LGPD (jnbvtyzr1ffz4ff5n05a999k) tinha um bloco de
 *   imagem apontando para armazenamento interno do Typebot (S3) e um bloco
 *   de texto imprimindo literalmente nomes de variáveis de ambiente
 *   (SUPABASE_PUBLIC_LGPD_URL | ...) — claramente um placeholder de rascunho
 *   nunca atualizado, exposto ao paciente. Substituído pela mensagem oficial
 *   do FLUXO OFICIAL PROVISÓRIO.txt (Etapa 3, mensagem de recusa).
 * - accepted_terms_at ({{now}}) só era registrado no aceite dos Termos de
 *   Uso — spec pede data/hora "para cada conjunto". Adicionadas
 *   lgpd_accepted_at e telemedicine_accepted_at nos respectivos grupos de
 *   registro, mesmo padrão ({{now}}) já usado em accepted_terms_at.
 * - blk_foto_txt combinava a confirmação de pagamento com instruções de
 *   formato divergentes do texto oficial pedido. Dividido em duas
 *   mensagens conforme os itens 5 e 6 do pedido.
 *
 * Não alterados (confirmados corretos ou fora de escopo por instrução
 * explícita): roteamento de todas as caixas; Termos de Uso (grp_termos_uso/
 * accept/decline — já preserva texto/documento/URL/nome do arquivo,
 * registra resposta/data/hora/URL); telemedicina_decline (já adequado);
 * bloco de pagamento (ulwovuu3brh5oeawwcuvr0h2, valor R$69,90, criação do
 * Checkout); Webhook para n8n (axuwb907...); qualquer lógica de Backend
 * (Stripe, upload, criação de atendimento — auditados separadamente, sem
 * necessidade de alteração no Typebot).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const TYPEBOT_ID = 'higij2z0xihxxkr378rmljgu';
const STAMP = '20260724-fluxo-final';

const report = { fixed: [], notes: [], idsConfirmados: {}, assertions: [] };
function check(name, ok, detail) {
  report.assertions.push({ name, ok: Boolean(ok), detail: detail === undefined ? null : detail });
  if (!ok) throw new Error(`ASSERTION FALHOU: ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`);
}
function findGroup(t, id) { const g = t.groups.find((x) => x.id === id); if (!g) throw new Error('grupo não encontrado: ' + id); return g; }
function findBlock(g, id) { const b = g.blocks.find((x) => x.id === id); if (!b) throw new Error(`bloco não encontrado: ${id} em ${g.id}`); return b; }
function blockText(b) { return (b.content.richText || []).map((p) => (p.children || []).map((c) => c.text || '').join('')).join('\n'); }
function blockUrls(b) { return JSON.stringify(b.content.richText || []); }
function textBlock(id, text) {
  return { id, type: 'text', content: { richText: text.split('\n').map((line, i) => ({ id: `${id}_p${i}`, type: 'p', children: [{ text: line }] })) } };
}
function linkBlock(id, emoji, label, url) {
  return {
    id, type: 'text',
    content: { richText: [{ id: `${id}_p0`, type: 'p', children: [{ text: emoji + ' ' }, { url, type: 'a', target: '_blank', children: [{ text: label }] }] }] }
  };
}

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

  const LGPD_URL = 'https://usihurogvphtjedyhyfl.supabase.co/storage/v1/object/public/documentos-publicos/Consentimento_LGPD_Doctor_Prescreve.pdf';
  const PRIVACY_URL = 'https://usihurogvphtjedyhyfl.supabase.co/storage/v1/object/public/documentos-publicos/Politica_de_Privacidade_Doctor_Prescreve.pdf';
  const TELE_URL = 'https://usihurogvphtjedyhyfl.supabase.co/storage/v1/object/public/documentos-publicos/Consentimento_Telemedicina_Assincrona_Doctor_Prescreve.pdf';
  const NONURG_URL = 'https://usihurogvphtjedyhyfl.supabase.co/storage/v1/object/public/documentos-publicos/Aviso_Nao_Urgencia_Emergencia.pdf';

  // =====================================================================
  // 1) LGPD + Política de Privacidade — 3 caixas
  // =====================================================================
  {
    const g = findGroup(t, 'b2l6ks9gkl95zebue3wri6tr');
    check('pré: 3 blocos antes (intro combinado, docs combinado, choice)', g.blocks.length === 3);
    check('pré: URLs atuais preservadas (LGPD)', blockUrls(findBlock(g, 'blk_lgpd_docs')).includes(LGPD_URL) && blockUrls(findBlock(g, 'blk_lgpd_docs')).includes(PRIVACY_URL));

    const choice = findBlock(g, 'ivbr3o1a7lv8izhfteuerhqx');
    check('pré: values do choice LGPD eram sim/nao (divergente da convenção)', choice.items[0].value === 'sim' && choice.items[1].value === 'nao');
    choice.items[0].value = 'true';
    choice.items[1].value = 'false';

    g.blocks = [
      textBlock('blk_lgpd_intro', 'Leia o Consentimento para Tratamento de Dados Pessoais e de Saúde antes de continuar.'),
      linkBlock('blk_lgpd_docs', '📄', 'Consentimento LGPD', LGPD_URL),
      textBlock('blk_lgpd_doc2_intro', 'Leia também a Política de Privacidade do Doctor Prescreve.'),
      linkBlock('blk_lgpd_doc2_link', '🔒', 'Política de Privacidade', PRIVACY_URL),
      textBlock('blk_lgpd_question', 'Após a leitura dos documentos, você autoriza o Doctor Prescreve a tratar seus dados pessoais e de saúde para realizar a triagem, o atendimento médico, o registro em prontuário e a possível emissão da receita digital?'),
      choice
    ];

    check('pós: 6 blocos (3 caixas: doc1 intro+link, doc2 intro+link, pergunta+choice)', g.blocks.length === 6);
    check('pós: values true/false', choice.items[0].value === 'true' && choice.items[1].value === 'false');
    check('pós: URLs preservadas', blockUrls(findBlock(g, 'blk_lgpd_docs')).includes(LGPD_URL) && blockUrls(findBlock(g, 'blk_lgpd_doc2_link')).includes(PRIVACY_URL));

    report.idsConfirmados.lgpd = {
      grupo: 'b2l6ks9gkl95zebue3wri6tr',
      caixa1: { intro: 'blk_lgpd_intro', link: 'blk_lgpd_docs' },
      caixa2: { intro: 'blk_lgpd_doc2_intro (novo)', link: 'blk_lgpd_doc2_link (novo)' },
      caixa3: { pergunta: 'blk_lgpd_question (novo)', choice: 'ivbr3o1a7lv8izhfteuerhqx' },
      variaveis: { lgpd_accepted: 'var_gs0egl8m', privacy_policy_accepted: 'var_qesjr9zn' }
    };
    report.fixed.push('1) LGPD: dividido em 3 caixas reais (doc1, doc2, pergunta+escolha); values do choice corrigidos de sim/nao para true/false (alinhado à convenção do resto do bot); URLs atuais preservadas.');
  }

  // =====================================================================
  // 1b) Recusa LGPD — mensagem oficial (conteúdo quebrado/placeholder)
  // =====================================================================
  {
    const g = findGroup(t, 'jnbvtyzr1ffz4ff5n05a999k');
    check('pré: grupo de recusa tinha 3 blocos (imagem quebrada + 2 textos)', g.blocks.length === 3 && g.blocks[0].type === 'image');
    const antes = g.blocks.map((b) => (b.type === 'image' ? `[image: ${b.content.url}]` : blockText(b))).join(' | ');
    check('pré: conteúdo continha placeholders de env var (confirma o bug)', /SUPABASE_PUBLIC_/.test(antes));

    g.blocks = [
      textBlock('skre2de1bnw4113hysub3fgj', 'Sem sua autorização, não será possível continuar o atendimento.\nNenhum atendimento foi criado e nenhuma cobrança foi realizada.')
    ];

    check('pós: grupo de recusa com 1 bloco de texto oficial', g.blocks.length === 1);
    check('pós: sem placeholders de env var', !/SUPABASE_PUBLIC_/.test(blockText(g.blocks[0])));

    report.idsConfirmados.lgpd_recusa = { grupo: 'jnbvtyzr1ffz4ff5n05a999k', blocoMensagem: 'skre2de1bnw4113hysub3fgj', removidos: ['kfa5kfgqdvkvttzo6xn6o8n0 (imagem)', 'mzwt4y2kbvuhdz7d29dtrgp2 (texto redundante)'] };
    report.fixed.push('1b) Recusa LGPD (grupo jnbvtyzr1ffz4ff5n05a999k): removida imagem quebrada (S3 interno do Typebot) e texto com placeholders de variável de ambiente expostos ao paciente ("SUPABASE_PUBLIC_LGPD_URL | ..."); substituído pela mensagem oficial de encerramento (FLUXO OFICIAL PROVISÓRIO.txt, Etapa 3).');
  }

  // =====================================================================
  // Registro LGPD — adiciona data/hora do conjunto (mesmo padrão de accepted_terms_at)
  // =====================================================================
  {
    if (!t.variables.some((v) => v.id === 'var_lgpd_accepted_at')) t.variables.push({ id: 'var_lgpd_accepted_at', name: 'lgpd_accepted_at', isSessionVariable: false });
    const g = findGroup(t, 'grp_lgpd_accept');
    const idx = g.blocks.findIndex((b) => b.id === 'blk_set_lgpd_links');
    check('grp_lgpd_accept: bloco de links encontrado para inserir data/hora ao lado', idx !== -1);
    g.blocks.splice(idx + 1, 0, { id: 'blk_set_lgpd_at', type: 'Set variable', options: { variableId: 'var_lgpd_accepted_at', expressionToEvaluate: '{{now}}' } });
    check('grp_lgpd_accept: blk_set_lgpd_at inserido', g.blocks.some((b) => b.id === 'blk_set_lgpd_at'));
    report.fixed.push('Registro LGPD (grp_lgpd_accept): adicionada lgpd_accepted_at ({{now}}), mesmo padrão já usado em accepted_terms_at — spec pede data/hora por conjunto de consentimento.');
  }

  // =====================================================================
  // 2) Telemedicina + Aviso de Não Urgência — 3 caixas
  // =====================================================================
  {
    const g = findGroup(t, 'grp_telemedicina_consent');
    check('pré: 3 blocos antes (intro combinado, docs combinado, choice)', g.blocks.length === 3);
    const choice = findBlock(g, 'blk_tele_choice');
    check('pré: values já true/false (nenhuma alteração necessária aqui)', choice.items[0].value === 'true' && choice.items[1].value === 'false');
    check('pré: URLs atuais preservadas (telemedicina)', blockUrls(findBlock(g, 'blk_tele_docs')).includes(TELE_URL) && blockUrls(findBlock(g, 'blk_tele_docs')).includes(NONURG_URL));

    g.blocks = [
      textBlock('blk_tele_intro', 'Leia o Consentimento para Telemedicina Assíncrona antes de continuar.'),
      linkBlock('blk_tele_docs', '🩺', 'Consentimento de Telemedicina', TELE_URL),
      textBlock('blk_tele_doc2_intro', 'Este serviço não substitui atendimento presencial em situações de urgência ou emergência. Leia o aviso abaixo.'),
      linkBlock('blk_tele_doc2_link', '⚠️', 'Aviso de Não Urgência', NONURG_URL),
      textBlock('blk_tele_question', 'Após a leitura dos documentos, você concorda com a realização do atendimento por telemedicina assíncrona e declara estar ciente de que este serviço não atende situações de urgência ou emergência?'),
      choice
    ];

    check('pós: 6 blocos (3 caixas)', g.blocks.length === 6);
    check('pós: URLs preservadas', blockUrls(findBlock(g, 'blk_tele_docs')).includes(TELE_URL) && blockUrls(findBlock(g, 'blk_tele_doc2_link')).includes(NONURG_URL));

    report.idsConfirmados.telemedicina = {
      grupo: 'grp_telemedicina_consent',
      caixa1: { intro: 'blk_tele_intro', link: 'blk_tele_docs' },
      caixa2: { intro: 'blk_tele_doc2_intro (novo)', link: 'blk_tele_doc2_link (novo)' },
      caixa3: { pergunta: 'blk_tele_question (novo)', choice: 'blk_tele_choice' },
      variaveis: { telemedicine_consent_accepted: 'var_678up7nr', non_urgency_notice_accepted: 'var_es63vwzc' }
    };
    report.fixed.push('2) Telemedicina: dividido em 3 caixas reais (doc1, doc2, pergunta+escolha); values já estavam corretos (true/false); URLs atuais preservadas. Grupo de recusa (grp_telemedicina_decline) já estava adequado — não alterado.');
  }

  // =====================================================================
  // Registro telemedicina — adiciona data/hora do conjunto
  // =====================================================================
  {
    if (!t.variables.some((v) => v.id === 'var_telemedicine_accepted_at')) t.variables.push({ id: 'var_telemedicine_accepted_at', name: 'telemedicine_accepted_at', isSessionVariable: false });
    const g = findGroup(t, 'grp_telemedicina_accept');
    const idx = g.blocks.findIndex((b) => b.id === 'blk_set_tele_links');
    check('grp_telemedicina_accept: bloco de links encontrado para inserir data/hora ao lado', idx !== -1);
    g.blocks.splice(idx + 1, 0, { id: 'blk_set_tele_at', type: 'Set variable', options: { variableId: 'var_telemedicine_accepted_at', expressionToEvaluate: '{{now}}' } });
    check('grp_telemedicina_accept: blk_set_tele_at inserido', g.blocks.some((b) => b.id === 'blk_set_tele_at'));
    report.fixed.push('Registro telemedicina (grp_telemedicina_accept): adicionada telemedicine_accepted_at ({{now}}), mesmo padrão de accepted_terms_at.');
  }

  // =====================================================================
  // 4) Termos de Uso — verificação (nenhuma alteração; "preservar provisoriamente")
  // =====================================================================
  {
    const g = findGroup(t, 'grp_termos_uso');
    check('4) Termos: texto/documento/URL atuais presentes', blockUrls(findBlock(g, 'blk_terms_doc')).includes('Politica_e_termos_de_uso_Doctor_Prescreve.pdf'));
    const choice = findBlock(g, 'blk_terms_choice');
    check('4) Termos: values já true/false, roteamento correto', choice.items[0].value === 'true' && choice.items[1].value === 'false');
    const accept = findGroup(t, 'grp_termos_accept');
    check('4) Termos: registro completo (aceite, data/hora, links, resumo)', accept.blocks.some((b) => b.id === 'blk_set_terms') && accept.blocks.some((b) => b.id === 'blk_set_terms_at') && accept.blocks.some((b) => b.id === 'blk_set_terms_links'));
    report.notes.push('4) Termos de Uso: já preservava texto/documento/URL/nome do arquivo atuais e já registrava resposta, data/hora (accepted_terms_at) e URL — nenhuma alteração feita, conforme instrução de preservar provisoriamente.');
  }

  // =====================================================================
  // 5+6) Mensagem pós-pagamento + envio da receita — blk_foto_txt
  // =====================================================================
  {
    const g = findGroup(t, 'grp_foto_receita');
    const antes = blockText(findBlock(g, 'blk_foto_txt'));
    check('pré: mensagem combinada divergente do texto oficial', !antes.includes('Formatos aceitos: JPG, PNG ou PDF'));

    const idx = g.blocks.findIndex((b) => b.id === 'blk_foto_txt');
    g.blocks[idx] = textBlock('blk_foto_txt', 'Pagamento confirmado com sucesso.\nAgora envie sua receita médica anterior pelo WhatsApp.');
    g.blocks.splice(idx + 1, 0, textBlock('blk_foto_formatos', 'Envie agora a foto ou o arquivo da sua receita médica anterior diretamente nesta conversa.\nFormatos aceitos: JPG, PNG ou PDF.'));

    check('pós: mensagem de confirmação de pagamento oficial', blockText(findBlock(g, 'blk_foto_txt')) === 'Pagamento confirmado com sucesso.\nAgora envie sua receita médica anterior pelo WhatsApp.');
    check('pós: mensagem de formatos oficial', blockText(findBlock(g, 'blk_foto_formatos')) === 'Envie agora a foto ou o arquivo da sua receita médica anterior diretamente nesta conversa.\nFormatos aceitos: JPG, PNG ou PDF.');
    check('pós: blk_upload_check ainda logo em seguida (sequencial, sem quebrar o input)', g.blocks[g.blocks.findIndex((b) => b.id === 'blk_upload_check') - 1].id === 'blk_foto_formatos');

    report.idsConfirmados.pagamento_upload = { grupo: 'grp_foto_receita', mensagemConfirmacao: 'blk_foto_txt', mensagemFormatos: 'blk_foto_formatos (novo)' };
    report.fixed.push('5+6) grp_foto_receita: blk_foto_txt corrigido para a mensagem oficial de confirmação de pagamento; nova blk_foto_formatos com a mensagem oficial de formatos aceitos (JPG, PNG ou PDF), preservando o input existente (blk_upload_check) e a edge de retry (edge_pending_resend_to_upload) que aponta para blk_foto_txt.');
  }

  // =====================================================================
  // VALIDAÇÕES FINAIS
  // =====================================================================
  const danglingAfter = findDangling(t);
  const newDangling = danglingAfter.filter((id) => !danglingBefore.includes(id));
  check('V. nenhuma edge nova quebrada', newDangling.length === 0, { preExistentes: danglingBefore, novas: newDangling });

  // edges explícitas de entrada continuam válidas (dependem dos IDs preservados)
  check('V. edge_sinais_to_telemedicine ainda aponta para blk_tele_intro existente', t.edges.find((e) => e.id === 'edge_sinais_to_telemedicine')?.to?.blockId === 'blk_tele_intro' && findGroup(t, 'grp_telemedicina_consent').blocks.some((b) => b.id === 'blk_tele_intro'));
  check('V. edge_pending_resend_to_upload ainda aponta para blk_foto_txt existente', t.edges.find((e) => e.id === 'edge_pending_resend_to_upload')?.to?.blockId === 'blk_foto_txt' && findGroup(t, 'grp_foto_receita').blocks.some((b) => b.id === 'blk_foto_txt'));
  check('V. roteamento LGPD accept/decline preservado', t.edges.find((e) => e.id === 'edge_lgpd_to_accept')?.to?.groupId === 'grp_lgpd_accept' && t.edges.find((e) => e.id === 'edge_lgpd_to_decline')?.to?.groupId === 'jnbvtyzr1ffz4ff5n05a999k');
  check('V. roteamento telemedicina accept/decline preservado', t.edges.find((e) => e.id === 'edge_tele_to_accept')?.to?.groupId === 'grp_telemedicina_accept' && t.edges.find((e) => e.id === 'edge_tele_to_decline')?.to?.groupId === 'grp_telemedicina_decline');
  check('V. pagamento (valor R$69,90, Webhook n8n) não alterado', findBlock(findGroup(t, 'ulwovuu3brh5oeawwcuvr0h2'), 'rapfykn1f1uno89ypqmwi43f').options.amount === '69.90');

  console.log('\n=== IDs CONFIRMADOS ===');
  console.log(JSON.stringify(report.idsConfirmados, null, 2));
  console.log('=== CORRIGIDO ===');
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
  fs.writeFileSync(path.join(ROOT, `backups/typebot-patch-fluxo-final-report-${STAMP}.json`), JSON.stringify(report, null, 2));

  console.log('\nOK — publicado.');
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
