/**
 * DANGEROUS / MANUAL USE ONLY — script histórico de recuperação pontual de
 * incidente (não é teste automatizado, não é idempotente de forma genérica).
 *
 * Retomada controlada do pagamento para sessão travada no payment input.
 * Sessão: feaf1518-aab9-4d97-a246-60f21b763f0f (phone 5511985485777)
 *
 * NÃO chama continueChat. NÃO avança Typebot. NÃO cria atendimento.
 * Apenas: createPaymentLinkForSession → sendPaymentIntro → CTA via Meta.
 */

'use strict';

process.env.NODE_ENV = process.env.NODE_ENV || 'production';
require('./_lib/guard-shared-environment').guardSharedEnvironment({ context: '_retomar-pagamento-sessao-stuck.js' });

async function main() {
  // Inicializa Supabase antes de qualquer serviço que use dbQuery
  const { initSupabase } = require('../src/config/supabase');
  initSupabase();

  const { createPaymentLinkForSession, sendPaymentIntro } =
    require('../src/services/typebot-payment-link.service');

  const SESSION_ID      = 'feaf1518-aab9-4d97-a246-60f21b763f0f';
  const TYPEBOT_SESSION = 'fl2oaffd433d1d0h9n72u2v7';
  const PHONE           = '5511985485777';
  const USERNAME        = 'Max';

  const identity = {
    phone:       PHONE,
    bsuid:       null,
    parentBsuid: null,
    username:    USERNAME
  };

  // Replica a estrutura mínima que o bridge usa ao chamar estas funções
  const existingSession = {
    id:                  SESSION_ID,
    phone:               PHONE,
    provider:            'meta',
    status:              'active',
    typebot_session_id:  TYPEBOT_SESSION,
    metadata: {
      typebot_expected_input_id: 'rapfykn1f1uno89ypqmwi43f'
    }
  };

  console.log('[retomar-pagamento] Iniciando createPaymentLinkForSession...');
  const link = await createPaymentLinkForSession({
    identity,
    typebotSessionId: TYPEBOT_SESSION,
    runtimeOptions:  {},
    existingSession
  });

  if (link.alreadyPaid) {
    console.log('[retomar-pagamento] ⚠️  Sessão já marcada como paga. Nada a fazer.');
    return;
  }

  console.log('[retomar-pagamento] checkoutRedirectUrl:', link.checkoutRedirectUrl);
  console.log('[retomar-pagamento] Chamando sendPaymentIntro...');

  const correlationId = `retomar-${SESSION_ID}-${Date.now()}`;
  const sent = await sendPaymentIntro({
    session:            existingSession,
    checkoutRedirectUrl: link.checkoutRedirectUrl,
    correlationId,
    idempotencyPrefix:  correlationId
  });

  console.log('[retomar-pagamento] ✅ CTA enviado. providerMessageIds:', sent);
}

main().catch((err) => {
  console.error('[retomar-pagamento] ❌ Erro:', err);
  process.exit(1);
});
