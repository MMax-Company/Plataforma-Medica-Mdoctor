export type ClinicalRejectReasonCode =
  | 'RED_FLAG'
  | 'DOCUMENTACAO_INSUFICIENTE'
  | 'RECEITA_AUSENTE'
  | 'FORA_DO_PROTOCOLO'
  | 'MEDICACAO_INCOMPATIVEL'
  | 'RISCO_CLINICO'
  | 'DADOS_INCONSISTENTES'
  | 'OUTROS';

export type ClinicalRejectReasonOption = {
  code: ClinicalRejectReasonCode;
  label: string;
  description: string;
  requiresDetail: boolean;
};

/** Motivos padronizados — espelham backend `clinical-reject-reasons.js` */
export const CLINICAL_REJECT_REASONS: ClinicalRejectReasonOption[] = [
  {
    code: 'RED_FLAG',
    label: 'Sinal de alerta / red flag',
    description: 'Paciente com sinais de alerta que exigem avaliação presencial.',
    requiresDetail: false,
  },
  {
    code: 'DOCUMENTACAO_INSUFICIENTE',
    label: 'Documentação insuficiente',
    description: 'Prontuário ou anexos insuficientes para decisão segura.',
    requiresDetail: false,
  },
  {
    code: 'RECEITA_AUSENTE',
    label: 'Receita anterior ausente',
    description: 'Sem comprovação válida de receita anterior.',
    requiresDetail: false,
  },
  {
    code: 'FORA_DO_PROTOCOLO',
    label: 'Fora do protocolo',
    description: 'Caso fora do protocolo de renovação por telemedicina.',
    requiresDetail: false,
  },
  {
    code: 'MEDICACAO_INCOMPATIVEL',
    label: 'Medicação incompatível',
    description: 'Medicação incompatível com histórico ou protocolo.',
    requiresDetail: false,
  },
  {
    code: 'RISCO_CLINICO',
    label: 'Risco clínico elevado',
    description: 'Risco incompatível com atendimento assíncrono.',
    requiresDetail: false,
  },
  {
    code: 'DADOS_INCONSISTENTES',
    label: 'Dados inconsistentes',
    description: 'Dados do paciente ou triagem inconsistentes.',
    requiresDetail: false,
  },
  {
    code: 'OUTROS',
    label: 'Outros',
    description: 'Descreva o motivo no campo de observações.',
    requiresDetail: true,
  },
];
