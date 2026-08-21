/**
 * Verifica o CONTEÚDO EXATO (body text, texto do botão, URL) das 4
 * mensagens CTA URL dos documentos iniciais (LGPD, Privacidade,
 * Telemedicina, Não Urgência), chamando o Typebot real diretamente
 * (sem depender de entrega real via Meta) e passando a resposta pelo
 * mesmo convertTypebotResponse que o bridge usa em produção.
 */
require('./load-dotenv');
const { fetchTypebot, convertTypebotResponse } = require('../src/services/typebot-whatsapp.bridge');

const config = {
  viewerUrl: String(process.env.TYPEBOT_VIEWER_URL || '').replace(/\/$/, ''),
  publicId: String(process.env.TYPEBOT_PUBLIC_ID || 'doctor-prescreve-8rmljgu').trim(),
  timeoutMs: 12000
};

// Mesmo mapeamento usado no bridge (typebot-whatsapp.bridge.js), só para
// exibir aqui o texto final do botão tal como seria enviado.
const DOC_BUTTON_LABELS = {
  'Consentimento LGPD': '📄Consentimento LGPD',
  'Política de Privacidade': '🔒 Pol. Privacidade',
  'Consentimento de Telemedicina': '🩺 Telemedicina',
  'Aviso de Não Urgência': '⚠️ Não Urgência',
  'Política e Termos de Uso': 'Termos de Uso'
};
function docButtonLabel(label) {
  return DOC_BUTTON_LABELS[label] || String(label || 'Abrir').slice(0, 20);
}

async function step(sessionId, text) {
  const path = sessionId ? `/sessions/${encodeURIComponent(sessionId)}/continueChat` : `/typebots/${encodeURIComponent(config.publicId)}/startChat`;
  const body = text ? { message: { type: 'text', text } } : {};
  return fetchTypebot(path, body, { config });
}

function report(label, typebotResponse) {
  const outputs = convertTypebotResponse(typebotResponse);
  console.log(`\n--- ${label} ---`);
  let ctaCount = 0;
  for (const output of outputs) {
    if (output.kind === 'document') {
      ctaCount += 1;
      const bodyText = output.introText || '📄 (FALLBACK — introText vazio!)';
      const displayText = docButtonLabel(output.label);
      console.log(`  CTA URL #${ctaCount}:`);
      console.log(`    body: ${JSON.stringify(bodyText)}`);
      console.log(`    displayText: ${JSON.stringify(displayText)} (len=${displayText.length})`);
      console.log(`    url: ${output.url}`);
      console.log(`    corpo vazio? ${!output.introText ? 'SIM (usaria fallback 📄) ⚠️' : 'não'}`);
    } else if (output.kind === 'text') {
      console.log(`  texto: ${JSON.stringify(output.text)}`);
    } else if (output.kind === 'buttons') {
      console.log(`  botões: body=${JSON.stringify(output.body)} choices=${JSON.stringify(output.choices.map((c) => c.value))}`);
    }
  }
  return { outputs, ctaCount };
}

async function main() {
  // Fluxo até chegar em LGPD (start -> "1" no menu não existe no Typebot
  // puro; entra direto no Bem-vindo -> Vamos começar -> LGPD).
  let r = await step(null);
  const sessionId = r.sessionId;
  console.log('sessionId', sessionId);
  report('startChat (Bem-vindo)', r);

  r = await step(sessionId, 'Vamos começar');
  const { ctaCount: lgpdCtas } = report('LGPD + Privacidade (grupo completo)', r);

  r = await step(sessionId, 'Autorizo');
  report('pós-LGPD (nome social)', r);
  r = await step(sessionId, 'Paciente Teste CTA');
  report('pós-nome-social (condições)', r);
  r = await step(sessionId, 'Hipertensão Arterial');
  report('pós-condições (tempo de uso)', r);
  r = await step(sessionId, 'Mais de 6 meses');
  report('pós-tempo-uso (sinais de alerta)', r);
  r = await step(sessionId, 'Nenhum desses sinais ou sintomas');
  const { ctaCount: teleCtas } = report('sinais de alerta -> Telemedicina + Não Urgência (grupo completo)', r);

  console.log('\n=== RESUMO ===');
  console.log('CTAs no grupo LGPD:', lgpdCtas, lgpdCtas === 2 ? 'OK' : 'FALHOU (esperado 2)');
  console.log('CTAs no grupo Telemedicina:', teleCtas, teleCtas === 2 ? 'OK' : 'FALHOU (esperado 2)');
}

main().catch((error) => {
  console.error('ERRO', error.message);
  process.exit(1);
});
