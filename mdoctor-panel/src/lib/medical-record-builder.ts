import type { MedicalRecord } from '@/types/medical-record';
import type { Patient } from '@/types/panel';

type ChronicCondition = 'hipertensao' | 'diabetes_tipo_2' | 'dislipidemia' | 'hipotireoidismo' | 'renovacao_receita';

const CONDITION_ALIASES: Array<{ value: ChronicCondition; terms: string[] }> = [
  { value: 'hipertensao', terms: ['has', 'hipertensao', 'hipertensão', 'pressao alta', 'pressão alta'] },
  { value: 'diabetes_tipo_2', terms: ['dm', 'dm2', 'diabetes', 'diabetes tipo 2', 'glicose alta'] },
  { value: 'dislipidemia', terms: ['dlp', 'dislipidemia', 'colesterol', 'triglicerides', 'triglicerídeos'] },
  { value: 'hipotireoidismo', terms: ['hipotireoidismo', 'tireoide', 'tiroide', 'levotiroxina'] },
];

const ELIGIBILITY_MESSAGE =
  'Paciente triado com sucesso pelo chatbot. Todos os critérios de elegibilidade foram atendidos.';

function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function detectCondition(condition: string, medication: string): ChronicCondition {
  const haystack = normalizeText(`${condition} ${medication}`);
  const matched = CONDITION_ALIASES.find((item) => item.terms.some((term) => haystack.includes(normalizeText(term))));
  return matched?.value || 'renovacao_receita';
}

function variantIndex(seed: string) {
  return seed.split('').reduce((acc, current) => acc + current.charCodeAt(0), 0) % 3;
}

function pickVariant(seed: string, variants: string[]) {
  return variants[variantIndex(seed)];
}

function buildProtocolNarrative(patient: Patient, clinical: Record<string, unknown>) {
  const conditionLabel = patient.condition || String(clinical.chronic_condition || clinical.condicao || 'condição crônica');
  const medication = patient.requestedMedication || String(clinical.medicacao_em_uso || clinical.medicamento || 'medicação em uso');
  const protocol = detectCondition(conditionLabel, medication);
  const seed = `${patient.id}-${protocol}-${medication}`;
  const eligible = patient.eligibility?.eligible !== false;

  const byProtocol: Record<ChronicCondition, { complaint: string[]; history: string[]; exam: string[]; conduct: string[] }> = {
    hipertensao: {
      complaint: [
        `Renovação de tratamento anti-hipertensivo (${medication}) para HAS, sem relato de crise hipertensiva recente.`,
        `Paciente com HAS em uso de ${medication}, buscando continuidade terapêutica por telemedicina.`,
        `Solicitação de renovação para controle pressórico com ${medication}, conforme protocolo de doença crônica.`,
      ],
      history: [
        'Histórico compatível com hipertensão arterial estável em uso contínuo, sem sinais de descompensação aguda na triagem.',
        'Relato de adesão ao anti-hipertensivo com documentação prévia enviada; elegibilidade condicionada aos critérios do protocolo HAS.',
        'Quadro crônico de HAS com seguimento remoto; dados de triagem sem red flags de urgência cardiovascular.',
      ],
      exam: [
        'Teleconsulta assíncrona. Sem aferição presencial de PA nesta etapa; decisão baseada em triagem estruturada e ausência de alarmes.',
        'Exame físico remoto indireto para HAS; orientado monitoramento domiciliar de pressão arterial.',
        'Sem avaliação presencial imediata; recomendada vigilância de sintomas neurológicos ou dor torácica.',
      ],
      conduct: eligible
        ? [
            `Conduta HAS: renovar ${medication} de forma conservadora, reforçar adesão, dieta hipossódica e retorno presencial se PA descontrolada.`,
            `Conduta HAS: autorizar renovação protocolar de ${medication} com orientação de monitoramento e sinais de alarme.`,
            `Conduta HAS: manter esquema atual com ${medication}, registrar critérios de segurança e vigilância clínica contínua.`,
          ]
        : [
            'Conduta HAS: renovação remota não autorizada nesta etapa por critério de segurança clínica.',
            'Conduta HAS: encaminhar para reavaliação presencial antes de nova tentativa de renovação.',
            'Conduta HAS: bloquear renovação automática até complementação documental ou avaliação presencial.',
          ],
    },
    diabetes_tipo_2: {
      complaint: [
        `Renovação de ${medication} para diabetes tipo 2, sem relato de hipoglicemia ou hiperglicemia sintomática recente.`,
        `Paciente com DM2 em uso de ${medication}, solicitando continuidade do tratamento.`,
        `Solicitação de renovação glicêmica com ${medication} dentro do protocolo de doença crônica.`,
      ],
      history: [
        'Histórico compatível com DM2 em uso contínuo; triagem sem sinais de cetoacidose ou descompensação aguda.',
        'Relato de adesão ao antidiabético com receita anterior anexada; elegibilidade conforme protocolo DM2.',
        'Seguimento crônico de DM2; dados declarados sem red flags metabólicos graves.',
      ],
      exam: [
        'Telemedicina assíncrona para DM2; sem glicemia capilar aferida no ato; decisão baseada em triagem e documentação.',
        'Exame remoto indireto; reforçar monitorização glicêmica domiciliar.',
        'Sem avaliação presencial nesta etapa; orientar procura imediata se sintomas de hiperglicemia grave.',
      ],
      conduct: eligible
        ? [
            `Conduta DM2: renovar ${medication} com orientação de dieta, atividade física e monitorização glicêmica.`,
            `Conduta DM2: autorizar renovação protocolar de ${medication} com reforço de adesão e sinais de alarme.`,
            `Conduta DM2: manter terapia com ${medication}, registrar renovação segura e vigilância ambulatorial.`,
          ]
        : [
            'Conduta DM2: renovação remota não autorizada por critério de segurança.',
            'Conduta DM2: recomendar consulta presencial para reavaliação metabólica.',
            'Conduta DM2: suspender renovação automática até nova triagem/documentação.',
          ],
    },
    dislipidemia: {
      complaint: [
        `Renovação de ${medication} para dislipidemia, sem relato de eventos cardiovasculares agudos recentes.`,
        `Paciente com dislipidemia em uso de ${medication}, buscando continuidade terapêutica.`,
        `Solicitação de renovação lipídica com ${medication} conforme protocolo crônico.`,
      ],
      history: [
        'Histórico compatível com dislipidemia estável em uso contínuo; triagem sem dor torácica ou dispneia de esforço nova.',
        'Documentação prévia enviada; elegibilidade conforme protocolo DLP e ausência de red flags.',
        'Quadro crônico de dislipidemia com seguimento remoto estruturado.',
      ],
      exam: [
        'Teleconsulta assíncrona para DLP; sem exames laboratoriais recentes anexados obrigatoriamente nesta etapa.',
        'Exame remoto indireto; orientar manutenção de hábitos e controle lipídico.',
        'Sem avaliação presencial imediata; orientar urgência se dor torácica ou sintomas neurológicos.',
      ],
      conduct: eligible
        ? [
            `Conduta DLP: renovar ${medication} com orientação dietética e acompanhamento lipídico periódico.`,
            `Conduta DLP: autorizar renovação protocolar de ${medication} com vigilância cardiovascular.`,
            `Conduta DLP: manter estatina/terapia lipídica (${medication}) com critérios de segurança registrados.`,
          ]
        : [
            'Conduta DLP: renovação remota não autorizada nesta etapa.',
            'Conduta DLP: encaminhar para avaliação presencial e exames complementares.',
            'Conduta DLP: bloquear renovação até reavaliação clínica presencial.',
          ],
    },
    hipotireoidismo: {
      complaint: [
        `Renovação de ${medication} para hipotireoidismo, sem relato de sintomas de descompensação tireoidiana aguda.`,
        `Paciente com hipotireoidismo em uso de ${medication}, solicitando continuidade.`,
        `Solicitação de renovação tireoidiana com ${medication} conforme protocolo crônico.`,
      ],
      history: [
        'Histórico compatível com hipotireoidismo em reposição estável; triagem sem sintomas de mixedema ou taquicardia nova.',
        'Uso contínuo de levotiroxina/terapia tireoidiana com receita anterior; elegibilidade conforme protocolo.',
        'Seguimento crônico de hipotireoidismo sem red flags na triagem automatizada.',
      ],
      exam: [
        'Telemedicina assíncrona; sem dosagem de TSH anexada obrigatoriamente nesta etapa.',
        'Exame remoto indireto; orientar vigilância de fadiga intensa, bradicardia ou palpitações.',
        'Sem avaliação presencial imediata; recomendar consulta se sintomas de descompensação.',
      ],
      conduct: eligible
        ? [
            `Conduta hipotireoidismo: renovar ${medication} com orientação de adesão e monitorização clínica periódica.`,
            `Conduta hipotireoidismo: autorizar renovação protocolar de ${medication} com vigilância de sintomas.`,
            `Conduta hipotireoidismo: manter reposição com ${medication}, registrar renovação segura.`,
          ]
        : [
            'Conduta hipotireoidismo: renovação remota não autorizada.',
            'Conduta hipotireoidismo: recomendar consulta presencial e exames tireoidianos.',
            'Conduta hipotireoidismo: bloquear renovação automática até reavaliação.',
          ],
    },
    renovacao_receita: {
      complaint: [
        `Paciente solicita renovação de ${medication} para controle de ${conditionLabel}, sem relato de piora aguda recente.`,
        `Solicitação de continuidade terapêutica para ${conditionLabel}, com foco em renovação de ${medication}.`,
        `Paciente em seguimento para ${conditionLabel}, buscando renovação de ${medication} via telemedicina.`,
      ],
      history: [
        'Histórico compatível com doença crônica estável. Dados de triagem sugerem manutenção terapêutica com documentação mínima.',
        'Relato de uso prévio com receita anterior enviada; elegibilidade condicionada aos critérios do protocolo.',
        'Triagem aponta cenário de renovação sem red flags críticos identificados.',
      ],
      exam: [
        'Atendimento em telemedicina assíncrona. Sem exame físico presencial nesta etapa.',
        'Exame físico remoto indireto; decisão baseada em triagem estruturada.',
        'Sem avaliação presencial; orientar retorno se piora clínica.',
      ],
      conduct: eligible
        ? [
            `Conduta: renovar ${medication} de forma conservadora, com vigilância clínica e retorno presencial se alarme.`,
            `Conduta: autorizar renovação protocolar de ${medication} com reforço de adesão.`,
            `Conduta: manter terapia com ${medication}, registrando critérios de segurança.`,
          ]
        : [
            'Conduta: renovação não autorizada nesta etapa por critério de segurança clínica.',
            'Conduta: recomendar reavaliação presencial antes de nova tentativa.',
            'Conduta: bloquear renovação remota até complementação documental.',
          ],
    },
  };

  const pack = byProtocol[protocol];
  const flaggedSignals = Array.isArray(clinical.flags) ? clinical.flags.map((flag) => String(flag)) : [];

  return {
    chiefComplaint: String(clinical.queixa_principal || pickVariant(seed, pack.complaint)),
    clinicalHistory: String(clinical.historico_clinico || pickVariant(`${seed}-h`, pack.history)),
    physicalExam: String(clinical.exame_fisico_telemedicina || clinical.exame_fisico || pickVariant(`${seed}-e`, pack.exam)),
    allergies: flaggedSignals.length
      ? `Sinais de atenção na triagem: ${flaggedSignals.join(', ')}. Revisar contraindicações antes da decisão.`
      : String(clinical.alergias || 'Sem relato de alergias medicamentosas graves na triagem.'),
    currentMedications: String(
      clinical.medicacao_em_uso ||
        `${medication}${patient.lastPrescription ? `. Última prescrição: ${patient.lastPrescription}` : ''}`,
    ),
    medicalConduct: String(clinical.conduta_sugerida || clinical.conduta_medica || pickVariant(`${seed}-c`, pack.conduct)),
    protocol,
  };
}

export function getPrescriptionImageUrl(patient: Patient): string | null {
  const clinical = patient.clinicalData || {};
  const url = clinical.foto_receita_url || clinical.previous_prescription_file || clinical.prescription_photo_url;
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  return trimmed.length > 3 ? trimmed : null;
}

export function buildMedicalRecord(patient: Patient): MedicalRecord {
  const clinical = (patient.clinicalData || {}) as Record<string, unknown>;
  const eligible = patient.eligibility?.eligible !== false;
  const narrative = buildProtocolNarrative(patient, clinical);

  return {
    id: patient.id,
    patient,
    eligibility: {
      approved: eligible,
      message: eligible
        ? ELIGIBILITY_MESSAGE
        : patient.eligibility?.reason || 'Paciente requer revisão médica antes da decisão.',
      criteria: [],
      badgeLabel: eligible ? 'VERIFICADO' : 'REVISÃO',
      protocolVersion: patient.eligibility?.protocolVersion || String(clinical.protocol_version || 'staging-clinical-v1'),
    },
    clinicalSummary: {
      chiefComplaint: narrative.chiefComplaint,
      clinicalHistory: narrative.clinicalHistory,
      physicalExam: narrative.physicalExam,
      allergies: narrative.allergies,
      currentMedications: narrative.currentMedications,
      medicalConduct: narrative.medicalConduct,
    },
    medicalHistory: {
      previousConditions: [patient.condition],
      previousPrescriptions: [patient.lastPrescription || 'Receita anterior enviada via Typebot'],
      risk: patient.risk,
      chatbotCompletedAt: patient.submittedAt,
      timeline: [`Triagem registrada às ${patient.submittedAt}`],
      highlightedMedication: patient.requestedMedication,
    },
    audit: {
      mode: 'panel',
      correlationId: String(clinical.correlation_id || ''),
    },
    notes: '',
    prescriptionImageUrl: getPrescriptionImageUrl(patient),
    protocolKey: narrative.protocol,
  };
}
