// Fase 3 pedido 3 — homologação automática final. Executa, em processos
// isolados (sem paciente real, sem rede/banco), TODAS as suítes de teste já
// construídas nas Fases 1-3 mais a nova suíte de suporte/perguntas finais
// deste pedido, e consolida um único resultado. Não reescreve nenhuma
// suíte existente — apenas as executa e agrega o resultado.
const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = [
  { file: 'test-whatsapp-menu-routing-unit.js', covers: 'menu inicial; opção 1; opção 2 e suporte (roteamento)' },
  { file: 'test-typebot-payment-idempotency.js', covers: 'pagamento (Stripe Checkout, webhook idempotente)' },
  { file: 'test-whatsapp-typebot-bridge.js', covers: 'sessão Typebot; pagamento; menu; duas mensagens rápidas; eventos duplicados' },
  { file: 'test-typebot-prescription-upload.js', covers: 'receita anterior pelo WhatsApp; criação do atendimento; fila médica' },
  { file: 'test-prescription-upload-ambiguity-unit.js', covers: 'isolamento entre dois pacientes (upload de receita anterior)' },
  { file: 'test-clinical-decision-approve-reject.js', covers: 'aprovação; reprovação sem estorno; eventos duplicados' },
  { file: 'test-clinical-prescription-delivery.js', covers: 'Memed; entrega da receita; vínculo único; eventos duplicados' },
  { file: 'test-clinical-support-and-survey.js', covers: 'opção 2/suporte; encerramento; retorno ao menu; perguntas finais; isolamento entre dois pacientes' }
];

// Cada suíte imprime só um JSON no final (compacto ou pretty-printed), às
// vezes precedido de linhas de log (dotenv, logger). Procura, da direita
// para a esquerda, o "{" a partir do qual o restante da saída é JSON válido.
function parseTrailingJson(stdout) {
  const text = String(stdout || '').trim();
  for (let i = text.lastIndexOf('{'); i >= 0; i = text.lastIndexOf('{', i - 1)) {
    try {
      return JSON.parse(text.slice(i));
    } catch {
      // tenta o "{" anterior
    }
  }
  return null;
}

function main() {
  const report = [];
  let allOk = true;

  for (const suite of SUITES) {
    const filePath = path.join(__dirname, suite.file);
    const result = spawnSync(process.execPath, [filePath], { encoding: 'utf8' });
    const ok = result.status === 0;
    if (!ok) allOk = false;

    const checks = ok ? parseTrailingJson(result.stdout) : null;

    report.push({
      suite: suite.file,
      covers: suite.covers,
      ok,
      checks_count: checks ? Object.keys(checks).length : 0,
      checks: checks || undefined,
      error: ok ? undefined : (result.stderr || result.stdout || '').trim().slice(0, 2000)
    });
  }

  const totalChecks = report.reduce((sum, r) => sum + r.checks_count, 0);
  console.log(
    JSON.stringify(
      {
        ok: allOk,
        suites_total: SUITES.length,
        suites_ok: report.filter((r) => r.ok).length,
        checks_total: totalChecks,
        report
      },
      null,
      2
    )
  );
  process.exit(allOk ? 0 : 1);
}

main();
