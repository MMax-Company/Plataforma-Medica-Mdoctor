/** Tipos alinhados ao padrão memed-react (devisales/memed-react). */

export interface MemedPatient {
  nome: string;
  idExterno: string;
  telefone?: string;
  endereco?: string;
  cidade?: string;
  cep?: string;
  cpf?: string;
  withoutCpf?: boolean;
  email?: string;
  data_nascimento?: string;
  sexo?: 'M' | 'F';
  peso?: number;
  altura?: number;
}

export interface MemedModuleOptions {
  onPrescriptionPrinted: (prescriptionData: unknown) => void;
  onPrescriptionDeleted?: (prescriptionData: unknown) => void;
}

export interface MemedScriptConfig {
  scriptUrl: string;
  scriptId: string;
  containerId: string;
  primaryColor: string;
}

export type MemedModuleInitPayload = { name?: string };
