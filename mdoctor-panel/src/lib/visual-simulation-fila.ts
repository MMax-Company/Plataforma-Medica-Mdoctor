import type { SupportQueueItem } from '@/components/medical/MedicalSupportBand';
import type { Patient } from '@/types/panel';

export const SIM_PREFIX = 'vis-sim-';

export type SimClinical = {
  condition: string;
  previous_prescription: boolean;
  continuous_use_proof: boolean;
  continuous_use_days?: number;
  receita_vencida_dias?: number;
  foto_receita_url?: string;
  flags?: string[];
  has_warning_signs?: boolean;
  medications?: Array<{ name: string; dose: string; frequency?: string }>;
  medication?: string;
  queixa_principal?: string;
  historico_clinico?: string;
  exame_fisico_telemedicina?: string;
  alergias?: string;
  medicacao_em_uso?: string;
  conduta_sugerida?: string;
  data_nascimento?: string;
  idade?: string;
  paciente_cpf?: string;
  prontuario_display?: string;
  endereco?: string;
  cep?: string;
  memed_receita?: {
    receitaUrl?: string;
    pdfUrl?: string;
    validated_at?: string;
  };
};

export type SimAtendimento = {
  id: string;
  status: 'FILA' | 'AWAITING_VALIDATION' | 'VALIDATED';
  paciente_nome: string;
  paciente_telefone: string;
  paciente_email?: string;
  condicao?: string;
  criado_em: string;
  pagamento_status: string;
  dados_clinicos: SimClinical;
};

function hoursAgo(hours: number, minutes = 0) {
  return new Date(Date.now() - hours * 3_600_000 - minutes * 60_000).toISOString();
}

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function meds(...items: Array<{ name: string; dose: string }>) {
  return items.map((item) => ({ ...item, frequency: '1x ao dia', route: 'oral', continuous: true }));
}

/** 10 pacientes — 4 elegíveis (motor) / 6 não elegíveis. Sem `elegibilidade` pré-preenchida na fila. */
function buildPatients(): SimAtendimento[] {
  const rxPhoto = 'https://placehold.co/600x800/f8fafc/5b6475?text=Receita+anterior';

  return [
    {
      id: `${SIM_PREFIX}p01`,
      status: 'FILA',
      paciente_nome: 'MVXZ',
      paciente_telefone: '(11) 98765-4321',
      paciente_email: 'paciente@email.com',
      condicao: 'Renovação de receita',
      criado_em: hoursAgo(6, 20),
      pagamento_status: 'PAGO',
      dados_clinicos: {
        condition: 'renovacao_receita',
        prontuario_display: '10273827',
        previous_prescription: true,
        continuous_use_proof: true,
        continuous_use_days: 800,
        receita_vencida_dias: 45,
        foto_receita_url: rxPhoto,
        medications: meds({ name: 'Losartana', dose: '50mg' }),
        medication: 'Losartana 50mg',
        data_nascimento: '15/04/1988',
        idade: '36 anos',
        paciente_cpf: '123.456.789-10',
        endereco: 'Rua das Flores, 123 — Ap 45',
        cep: '01458-000',
        queixa_principal:
          'Paciente se refere que sua receita está fora do prazo de validade, vem para consulta teleconsulta assíncrona para renovação de sua receita de uso contínuo. Sem queixas.',
        historico_clinico:
          'Paciente faz uso de medicação para doença crônica de forma contínua, não evidenciando sinais em teleconsulta assíncrona que impeça de realizar a renovação de sua receita.\n\nPaciente nega qualquer alteração física ou sinais e sintomas ou internação prévia.',
        exame_fisico_telemedicina:
          'Paciente nega qualquer alteração física ou clínica.\n\nNão apresenta sinais de alerta, nem critérios que o impeça de renovar a receita.\n\nEstável clinicamente.',
        alergias: 'Nega alergias medicamentosas ou alimentares.',
        medicacao_em_uso: 'Já declarado na teletriagem.\n\nNão há contraindicações identificadas.',
        conduta_sugerida:
          'Realizado renovação da receita de uso contínuo, emitida via certificado digital, dentro dos critérios permitidos, não constatando a necessidade de avaliação presencial.\n\nPaciente estável clinicamente, encaminha receita digital via WhatsApp ou e-mail designado ao paciente.\n\nPaciente orientado a procurar atendimento presencial, se necessário.\n\nEm caso de sinais de alerta, o paciente deverá procurar pronto atendimento.\n\nPaciente assinou os termos de telemedicina e declara que é responsável pela veracidade dos dados informados.',
      },
    },
    {
      id: `${SIM_PREFIX}p02`,
      status: 'FILA',
      paciente_nome: 'Fernanda Costa',
      paciente_telefone: '5511977665502',
      paciente_email: 'fernanda.costa@email.com',
      condicao: 'Diabetes tipo 2',
      criado_em: hoursAgo(5, 5),
      pagamento_status: 'PAGO',
      dados_clinicos: {
        condition: 'diabetes tipo 2',
        previous_prescription: true,
        continuous_use_proof: true,
        continuous_use_days: 1825,
        receita_vencida_dias: 60,
        foto_receita_url: rxPhoto,
        medications: meds(
          { name: 'Metformina', dose: '850mg' },
          { name: 'Gliclazida', dose: '30mg' },
        ),
        medication: 'Metformina 850mg',
        medicacao_em_uso: 'Metformina 850mg; Gliclazida 30mg',
        queixa_principal: 'Renovação de esquema antidiabético oral para DM2.',
        historico_clinico: 'DM2 em tratamento contínuo há 5 anos; receita vencida há 60 dias.',
        data_nascimento: '1972-11-08',
        paciente_cpf: '45678912345',
        endereco: 'Av. Brasil, 1500 - Rio de Janeiro/RJ',
        cep: '22041080',
      },
    },
    {
      id: `${SIM_PREFIX}p03`,
      status: 'FILA',
      paciente_nome: 'Marcos Oliveira',
      paciente_telefone: '5511966554403',
      paciente_email: 'marcos.oliveira@email.com',
      condicao: 'Hipotireoidismo e HAS',
      criado_em: hoursAgo(4, 10),
      pagamento_status: 'PAGO',
      dados_clinicos: {
        condition: 'hipotireoidismo',
        previous_prescription: true,
        continuous_use_proof: true,
        continuous_use_days: 1460,
        receita_vencida_dias: 90,
        foto_receita_url: rxPhoto,
        medications: meds(
          { name: 'Levotiroxina', dose: '50mcg' },
          { name: 'Losartana', dose: '50mg' },
          { name: 'Hidroclorotiazida', dose: '25mg' },
        ),
        medication: 'Levotiroxina 50mcg',
        medicacao_em_uso: 'Levotiroxina 50mcg; Losartana 50mg; Hidroclorotiazida 25mg',
        queixa_principal: 'Renovação de terapia para hipotireoidismo e controle pressórico associado.',
        historico_clinico: 'Uso contínuo há 4 anos; receita anterior vencida há 90 dias.',
        data_nascimento: '1969-07-22',
        paciente_cpf: '78912345678',
        endereco: 'Rua Minas Gerais, 88 - Belo Horizonte/MG',
        cep: '30130100',
      },
    },
    {
      id: `${SIM_PREFIX}p04`,
      status: 'VALIDATED',
      paciente_nome: 'Patrícia Mendes',
      paciente_telefone: '5511955443304',
      paciente_email: 'patricia.mendes@email.com',
      condicao: 'Dislipidemia',
      criado_em: hoursAgo(0, 35),
      pagamento_status: 'PAGO',
      dados_clinicos: {
        condition: 'dislipidemia',
        previous_prescription: true,
        continuous_use_proof: true,
        continuous_use_days: 540,
        receita_vencida_dias: 20,
        foto_receita_url: rxPhoto,
        medications: meds({ name: 'Rosuvastatina', dose: '20mg' }),
        medication: 'Rosuvastatina 20mg',
        medicacao_em_uso: 'Rosuvastatina 20mg',
        queixa_principal: 'Renovação de Rosuvastatina 20mg para dislipidemia em uso regular.',
        historico_clinico: 'Controle lipídico estável; receita vencida há 20 dias.',
        memed_receita: {
          receitaUrl: 'https://placehold.co/600x800/png?text=Receita+validada',
          pdfUrl: 'https://placehold.co/600x800/png?text=Receita+validada',
          validated_at: new Date().toISOString(),
        },
        data_nascimento: '1985-01-15',
        paciente_cpf: '11223344556',
        endereco: 'Rua Oscar Freire, 300 - São Paulo/SP',
        cep: '01426000',
      },
    },
    {
      id: `${SIM_PREFIX}p05`,
      status: 'FILA',
      paciente_nome: 'Eduardo Lima',
      paciente_telefone: '5511944332205',
      paciente_email: 'eduardo.lima@email.com',
      condicao: 'Hipertensão arterial',
      criado_em: hoursAgo(3, 0),
      pagamento_status: 'PAGO',
      dados_clinicos: {
        condition: 'hipertensao',
        previous_prescription: true,
        continuous_use_proof: true,
        continuous_use_days: 900,
        receita_vencida_dias: 210,
        foto_receita_url: rxPhoto,
        medications: meds({ name: 'Losartana', dose: '50mg' }),
        medication: 'Losartana 50mg',
        medicacao_em_uso: 'Losartana 50mg',
        queixa_principal: 'Solicita renovação; última receita com vencimento há mais de 6 meses.',
        historico_clinico: 'Relato de uso prévio; documentação com receita muito antiga.',
        data_nascimento: '1970-09-30',
        paciente_cpf: '99887766554',
        endereco: 'Rua XV de Novembro, 45 - Curitiba/PR',
        cep: '80020300',
      },
    },
    {
      id: `${SIM_PREFIX}p06`,
      status: 'FILA',
      paciente_nome: 'Juliana Rocha',
      paciente_telefone: '5511933221106',
      paciente_email: 'juliana.rocha@email.com',
      condicao: 'Diabetes tipo 2',
      criado_em: hoursAgo(2, 15),
      pagamento_status: 'PAGO',
      dados_clinicos: {
        condition: 'diabetes tipo 2',
        previous_prescription: true,
        continuous_use_proof: true,
        continuous_use_days: 18,
        receita_vencida_dias: 10,
        foto_receita_url: rxPhoto,
        medications: meds({ name: 'Metformina', dose: '850mg' }),
        medication: 'Metformina 850mg',
        medicacao_em_uso: 'Metformina 850mg',
        queixa_principal: 'Início recente de tratamento para DM2 (menos de 30 dias).',
        historico_clinico: 'Tratamento iniciado há 18 dias; aguarda estabilização para renovação remota.',
        data_nascimento: '1990-04-18',
        paciente_cpf: '55443322110',
        endereco: 'Rua Floriano, 12 - Porto Alegre/RS',
        cep: '90010000',
      },
    },
    {
      id: `${SIM_PREFIX}p07`,
      status: 'AWAITING_VALIDATION',
      paciente_nome: 'Ricardo Souza',
      paciente_telefone: '5511922110007',
      paciente_email: 'ricardo.souza@email.com',
      condicao: 'Hipertensão arterial',
      criado_em: hoursAgo(1, 5),
      pagamento_status: 'PAGO',
      dados_clinicos: {
        condition: 'hipertensao',
        previous_prescription: true,
        continuous_use_proof: true,
        continuous_use_days: 400,
        receita_vencida_dias: 30,
        medications: meds({ name: 'Losartana', dose: '50mg' }),
        medication: 'Losartana 50mg',
        medicacao_em_uso: 'Losartana 50mg',
        queixa_principal: 'Renovação de anti-hipertensivo; foto da receita não enviada na triagem.',
        historico_clinico: 'Uso contínuo relatado sem anexo de receita anterior.',
        data_nascimento: '1982-12-05',
        paciente_cpf: '66778899001',
        endereco: 'Rua da Consolação, 900 - São Paulo/SP',
        cep: '01302000',
      },
    },
    {
      id: `${SIM_PREFIX}p08`,
      status: 'AWAITING_VALIDATION',
      paciente_nome: 'Amanda Ferreira',
      paciente_telefone: '5511911009908',
      paciente_email: 'amanda.ferreira@email.com',
      condicao: 'Hipertensão arterial',
      criado_em: hoursAgo(0, 48),
      pagamento_status: 'PAGO',
      dados_clinicos: {
        condition: 'hipertensao',
        previous_prescription: true,
        continuous_use_proof: true,
        continuous_use_days: 600,
        receita_vencida_dias: 25,
        foto_receita_url: rxPhoto,
        has_warning_signs: true,
        flags: ['sinais_urgencia', 'sintomas_novos'],
        medications: meds({ name: 'Losartana', dose: '50mg' }),
        medication: 'Losartana 50mg',
        medicacao_em_uso: 'Losartana 50mg',
        queixa_principal: 'Relata cefaleia intensa e dor torácica nas últimas 48h.',
        historico_clinico: 'Sinais de alerta relatados na triagem; requer avaliação presencial.',
        data_nascimento: '1988-06-14',
        paciente_cpf: '22334455667',
        endereco: 'Av. Paulista, 1200 - São Paulo/SP',
        cep: '01310100',
      },
    },
    {
      id: `${SIM_PREFIX}p09`,
      status: 'AWAITING_VALIDATION',
      paciente_nome: 'Gustavo Nunes',
      paciente_telefone: '5511900998809',
      paciente_email: 'gustavo.nunes@email.com',
      condicao: 'Ansiedade',
      criado_em: hoursAgo(0, 32),
      pagamento_status: 'PAGO',
      dados_clinicos: {
        condition: 'renovacao_receita',
        previous_prescription: true,
        continuous_use_proof: true,
        continuous_use_days: 365,
        receita_vencida_dias: 40,
        foto_receita_url: rxPhoto,
        flags: ['contraindicacao_basica'],
        medications: meds({ name: 'Clonazepam', dose: '2mg' }),
        medication: 'Clonazepam 2mg',
        medicacao_em_uso: 'Clonazepam 2mg',
        queixa_principal: 'Solicita renovação de medicação controlada fora do protocolo atual.',
        historico_clinico: 'Pedido de benzodiazepínico; não elegível para renovação remota automática.',
        data_nascimento: '1975-02-28',
        paciente_cpf: '33445566778',
        endereco: 'Rua Sete de Setembro, 400 - Salvador/BA',
        cep: '40060000',
      },
    },
    {
      id: `${SIM_PREFIX}p10`,
      status: 'FILA',
      paciente_nome: 'Carla Dias',
      paciente_telefone: '5511899887700',
      paciente_email: 'carla.dias@email.com',
      condicao: 'Diabetes tipo 2',
      criado_em: hoursAgo(1, 40),
      pagamento_status: 'PAGO',
      dados_clinicos: {
        condition: 'enxaqueca recorrente',
        previous_prescription: true,
        continuous_use_proof: true,
        continuous_use_days: 500,
        receita_vencida_dias: 35,
        foto_receita_url: rxPhoto,
        medications: meds({ name: 'Losartana', dose: '50mg' }),
        medication: 'Losartana 50mg',
        medicacao_em_uso: 'Losartana 50mg',
        queixa_principal: 'Triagem informa DM2, mas conduta e medicamento não compatíveis com protocolo de renovação.',
        historico_clinico: 'Inconsistência entre doença relatada na triagem e condição elegível para telemedicina.',
        data_nascimento: '1983-10-03',
        paciente_cpf: '44556677889',
        endereco: 'Rua Goiás, 55 - Goiânia/GO',
        cep: '74000000',
      },
    },
  ];
}

let cachedPatients: SimAtendimento[] | null = null;

export function getVisualSimulationAtendimentos(): SimAtendimento[] {
  if (!cachedPatients) cachedPatients = buildPatients();
  return cachedPatients;
}

export function buildVisualSimulationAtendimentos(): SimAtendimento[] {
  return getVisualSimulationAtendimentos();
}

export function isVisualSimulationMode(): boolean {
  if (typeof globalThis.window === 'undefined') {
    return process.env.NEXT_PUBLIC_VISUAL_SIM_FILA === 'true';
  }
  const params = new URLSearchParams(globalThis.window.location.search);
  return params.get('visualSim') === '1' || process.env.NEXT_PUBLIC_VISUAL_SIM_FILA === 'true';
}

export function isVisualSimulationPatient(id: string) {
  return id.startsWith(SIM_PREFIX);
}

export function buildEligibilityPayload(
  clinical: SimClinical,
  condicao?: string,
): Record<string, unknown> {
  return {
    condition: clinical.condition || condicao || '',
    previous_prescription: clinical.previous_prescription,
    continuous_use_proof: clinical.continuous_use_proof,
    continuous_use_days: clinical.continuous_use_days,
    receita_vencida_dias: clinical.receita_vencida_dias,
    foto_receita_url: clinical.foto_receita_url,
    previous_prescription_file: clinical.foto_receita_url,
    flags: clinical.flags || [],
    has_warning_signs: clinical.has_warning_signs,
    medications: clinical.medications,
    medication: clinical.medication,
    medicacao_em_uso: clinical.medicacao_em_uso,
  };
}

export function simAtendimentoToPatient(item: SimAtendimento): Patient {
  const clinical = item.dados_clinicos;
  const birth = clinical.data_nascimento || '1985-01-01';
  const birthYear = Number(birth.slice(0, 4));
  const age = Number.isFinite(birthYear) ? Math.max(18, new Date().getFullYear() - birthYear) : 40;

  const statusMap: Record<SimAtendimento['status'], Patient['status']> = {
    FILA: 'waiting',
    AWAITING_VALIDATION: 'under_review',
    VALIDATED: 'ready',
  };

  return {
    id: item.id,
    name: item.paciente_nome,
    age,
    phone: item.paciente_telefone,
    condition: item.condicao || clinical.condition,
    requestedMedication: clinical.medication || clinical.medicacao_em_uso || '—',
    submittedAt: item.criado_em,
    status: statusMap[item.status],
    risk: 'low',
    source: 'Typebot',
    paymentStatus: 'paid',
    cpf: clinical.paciente_cpf,
    email: item.paciente_email,
    birthDate: birth,
    address: clinical.endereco,
    clinicalData: clinical as Record<string, unknown>,
    prescriptionValidated: item.status === 'VALIDATED',
  };
}

export function getVisualSimulationPatientById(id: string): Patient | null {
  const hit = getVisualSimulationAtendimentos().find((item) => item.id === id);
  return hit ? simAtendimentoToPatient(hit) : null;
}

export const VIS_SIM_ELIGIBLE_IDS = [
  `${SIM_PREFIX}p01`,
  `${SIM_PREFIX}p02`,
  `${SIM_PREFIX}p03`,
  `${SIM_PREFIX}p04`,
] as const;

export const VIS_SIM_INELIGIBLE_IDS = [
  `${SIM_PREFIX}p05`,
  `${SIM_PREFIX}p06`,
  `${SIM_PREFIX}p07`,
  `${SIM_PREFIX}p08`,
  `${SIM_PREFIX}p09`,
  `${SIM_PREFIX}p10`,
] as const;

export function buildVisualSimulationSupport(): SupportQueueItem[] {
  return [
    { id: `${SIM_PREFIX}sup-01`, paciente_nome: 'Helena K.', paciente_telefone: '5511888776655', criado_em: minutesAgo(3) },
    { id: `${SIM_PREFIX}sup-02`, paciente_nome: 'Igor V.', paciente_telefone: '5511877665544', criado_em: minutesAgo(5) },
    { id: `${SIM_PREFIX}sup-03`, paciente_nome: 'Larissa N.', paciente_telefone: '5511866554433', criado_em: minutesAgo(7) },
    { id: `${SIM_PREFIX}sup-04`, paciente_nome: 'Otávio B.', paciente_telefone: '5511855443322', criado_em: minutesAgo(9) },
    { id: `${SIM_PREFIX}sup-05`, paciente_nome: 'Patrícia G.', paciente_telefone: '5511844332211', criado_em: minutesAgo(11) },
    { id: `${SIM_PREFIX}sup-06`, paciente_nome: 'Renato H.', paciente_telefone: '5511833221100', criado_em: minutesAgo(14) },
  ];
}
