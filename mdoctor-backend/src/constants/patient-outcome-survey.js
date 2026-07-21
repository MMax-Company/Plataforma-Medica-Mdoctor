const SURVEY_VERSION = 'fase1_v1';

const Q1_OPTIONS = {
  '1': 'pronto_socorro',
  '2': 'ubs',
  '3': 'consultorio_particular',
  '4': 'sem_medicacao',
  '5': 'outro',
  pronto_socorro: 'pronto_socorro',
  prontosocorro: 'pronto_socorro',
  ubs: 'ubs',
  consultorio_particular: 'consultorio_particular',
  consultorio: 'consultorio_particular',
  sem_medicacao: 'sem_medicacao',
  semmedicacao: 'sem_medicacao',
  outro: 'outro'
};

const Q2_Q3_OPTIONS = {
  '1': 'sim',
  '2': 'nao',
  sim: 'sim',
  nao: 'nao',
  yes: 'sim',
  no: 'nao'
};

const PRESCRIPTION_SENT_MESSAGE = [
  'Sua receita foi enviada com sucesso.',
  '',
  'Obrigado por utilizar o *Doctor Prescreve*.'
].join('\n');

const SURVEY_OPT_IN_MESSAGE = [
  'Antes de encerrar, você pode nos ajudar respondendo 3 perguntas rápidas? É opcional.',
  '',
  '*1* - Sim, claro!',
  '*2* - Não, obrigado'
].join('\n');

const SURVEY_OPT_IN_DECLINED_MESSAGE = 'Tudo bem! Qualquer dúvida, estamos aqui. Até a próxima!';

const Q1_MESSAGE = [
  '*Pergunta 1 de 3*',
  'Sem o Doctor Prescreve, o que você faria para conseguir sua receita?',
  '',
  '*1* - Pronto-socorro',
  '*2* - UBS',
  '*3* - Consultório particular',
  '*4* - Ficaria sem a medicação',
  '*5* - Outro'
].join('\n');

const Q2_MESSAGE = [
  '*Pergunta 2 de 3*',
  'O Doctor Prescreve ajudou a evitar que você ficasse sem a medicação?',
  '',
  '*1* - Sim',
  '*2* - Não'
].join('\n');

const Q3_MESSAGE = [
  '*Pergunta 3 de 3*',
  'Você utilizaria novamente o Doctor Prescreve?',
  '',
  '*1* - Sim',
  '*2* - Não'
].join('\n');

const THANK_YOU_MESSAGE = 'Obrigado pelas respostas! Sua participação é muito importante para nós.';

function normalizeAnswer(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');
}

function parseQ1Answer(raw = '') {
  const normalized = normalizeAnswer(raw);
  if (Q1_OPTIONS[normalized]) return Q1_OPTIONS[normalized];
  const digits = normalized.replace(/\D/g, '');
  if (Q1_OPTIONS[digits]) return Q1_OPTIONS[digits];
  return null;
}

function parseYesNoAnswer(raw = '') {
  const normalized = normalizeAnswer(raw);
  if (Q2_Q3_OPTIONS[normalized]) return Q2_Q3_OPTIONS[normalized];
  const digits = normalized.replace(/\D/g, '');
  if (Q2_Q3_OPTIONS[digits]) return Q2_Q3_OPTIONS[digits];
  return null;
}

module.exports = {
  SURVEY_VERSION,
  PRESCRIPTION_SENT_MESSAGE,
  SURVEY_OPT_IN_MESSAGE,
  SURVEY_OPT_IN_DECLINED_MESSAGE,
  Q1_MESSAGE,
  Q2_MESSAGE,
  Q3_MESSAGE,
  THANK_YOU_MESSAGE,
  parseQ1Answer,
  parseYesNoAnswer
};
