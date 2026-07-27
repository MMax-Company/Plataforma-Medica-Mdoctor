const PAYMENT_AMOUNT_CENTS = 6990;
const PAYMENT_AMOUNT_LABEL = 'R$ 69,90';
const PAYMENT_BUTTON_LABEL = 'Pagar R$ 69,90';

const PRE_PAYMENT_MESSAGE = [
  'O valor da consulta médica e da análise das informações enviadas é de R$ 69,90.',
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
  PAYMENT_PENDING_CHOICES,
  PAYMENT_PENDING_MESSAGE,
  PRE_PAYMENT_MESSAGE
};
