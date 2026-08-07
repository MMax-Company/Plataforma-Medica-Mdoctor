const PAYMENT_AMOUNT_CENTS = 4990;
const PAYMENT_AMOUNT_LABEL = 'R$ 49,90';
const PAYMENT_BUTTON_LABEL = 'Pagar R$ 49,90';

// Pix adicionado ao Checkout mantendo cartão (cartão continua sendo a
// primeira opção exibida). Mesmo valor/atendimento/webhook/confirmação do
// cartão — Pix usa o mesmo checkout.session.completed e os mesmos checks de
// amount_total/currency em stripeSessionIsPaid, sem lógica nova.
const PAYMENT_METHOD_TYPES = ['card'];
// 30 minutos: prazo curto o bastante para não deixar o paciente com Pix
// "pendurado" no meio do atendimento assíncrono, e alinhado ao limite mínimo
// permitido pela Stripe (10s) e ao teto de 14 dias — ajustável em revisão
// antes do commit, sem exigir mudança de código (só este valor).
const PIX_EXPIRES_AFTER_SECONDS = 1800;

const PRE_PAYMENT_MESSAGE = [
  'O valor da consulta médica e da análise das informações enviadas é de R$ 49,90.',
  '',
  'O pagamento corresponde à consulta e não garante a emissão da receita.',
  '',
  'Após a confirmação do pagamento, o atendimento continuará automaticamente.'
].join('\n');

const PAYMENT_PENDING_MESSAGE = [
  'Ainda não recebemos a confirmação do pagamento.',
  '',
  'Se você já concluiu, aguarde alguns instantes e selecione Conferir pagamento.'
].join('\n');

const PAYMENT_FAILED_MESSAGE = 'Não foi possível confirmar o pagamento. Você pode tentar novamente.';
const PAYMENT_CANCELLED_MESSAGE = 'O pagamento não foi concluído. Nenhuma cobrança foi confirmada.';

const PAYMENT_INPUT_ID = 'rapfykn1f1uno89ypqmwi43f';
const PAYMENT_BTN_CHECK = 'payment_check';
const PAYMENT_BTN_REOPEN = 'payment_reopen';
const PAYMENT_BTN_CANCEL = 'payment_cancel';

const PAYMENT_PENDING_CHOICES = [
  { id: PAYMENT_BTN_CHECK, title: 'Conferir pagamento', value: 'Conferir pagamento' },
  { id: PAYMENT_BTN_REOPEN, title: 'Abrir pagamento', value: 'Abrir pagamento novamente' },
  { id: PAYMENT_BTN_CANCEL, title: 'Cancelar', value: 'Cancelar e continuar depois' }
];

const ALLOWED_PAYMENT_STATUS = new Set(['pending', 'paid', 'failed', 'cancelled']);

module.exports = {
  ALLOWED_PAYMENT_STATUS,
  PAYMENT_AMOUNT_CENTS,
  PAYMENT_AMOUNT_LABEL,
  PAYMENT_BTN_CANCEL,
  PAYMENT_BTN_CHECK,
  PAYMENT_BTN_REOPEN,
  PAYMENT_BUTTON_LABEL,
  PAYMENT_CANCELLED_MESSAGE,
  PAYMENT_FAILED_MESSAGE,
  PAYMENT_INPUT_ID,
  PAYMENT_METHOD_TYPES,
  PAYMENT_PENDING_CHOICES,
  PAYMENT_PENDING_MESSAGE,
  PIX_EXPIRES_AFTER_SECONDS,
  PRE_PAYMENT_MESSAGE
};
