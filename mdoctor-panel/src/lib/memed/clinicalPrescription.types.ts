/** Camada clínica interna — Doctor Prescreve (não enviar estes campos crus à Memed). */

export type ClinicalPrescriptionItem = {
  medicamento: string;
  concentracao?: string;
  forma?: string;
  via?: string;
  dose?: string;
  frequencia?: string;
  duracao?: string;
  uso_continuo?: boolean;
  quantidade_sugerida?: number | null;
  observacao_clinica?: string;
  /** true quando faltam dados essenciais para montar prescrição segura */
  pendente_revisao_medica?: boolean;
  pendente_motivos?: string[];
};

/** Saída compatível com MdHub `addItem` — somente campos documentados. */
export type MemedPrescriptionItem = {
  nome: string;
  posologia: string;
  quantidade?: number;
};

export type ClinicalPrescriptionToMemedResult = {
  clinical_items: ClinicalPrescriptionItem[];
  memed_items: MemedPrescriptionItem[];
  pending_medical_review: boolean;
  pending_reasons: string[];
};
