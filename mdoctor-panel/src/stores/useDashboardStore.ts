'use client';

import { create } from 'zustand';
import { approveClinicalDecision, rejectClinicalDecision } from '@/services/clinical-decision';
import { sendPrescriptionDelivery } from '@/services/prescriptions';
import type { DeliveryChannel } from '@/types/panel';
import {
  belongsToMedicalWaitingQueue,
  belongsToMemedProcessingQueue,
  belongsToReadyPrescriptionQueue,
} from '@/lib/patient-display';
import { getMockPatients, getPatients, getSupportPatients, updatePatientStatus } from '@/services/patients';
import type { Patient, PanelMetric } from '@/types/panel';

const initialPatients = getMockPatients();

interface DashboardStore {
  patients: Patient[];
  supportPatients: Patient[];
  metrics: PanelMetric[];
  loading: boolean;
  usingMockFallback: boolean;
  supportUsingMockFallback: boolean;
  error: string | null;
  loadPatients: () => Promise<void>;
  startReview: (patientId: string) => void;
  approvePrescription: (patientId: string) => void;
  acceptMemedPrescription: (patientId: string) => void;
  approveMedicalRecord: (
    patientId: string,
    payload?: { notes?: string; conduta_medica?: string; dados_clinicos?: Record<string, unknown> },
  ) => Promise<void>;
  rejectMedicalRecord: (
    patientId: string,
    payload?: {
      notes?: string;
      motivo?: string;
      mensagem_whatsapp?: string;
      dados_clinicos?: Record<string, unknown>;
    },
  ) => Promise<void>;
  sendPrescription: (patientId: string, channel: DeliveryChannel) => Promise<DeliveryChannel[]>;
}

function buildMetrics(patients: Patient[]): PanelMetric[] {
  const waiting = patients.filter(belongsToMedicalWaitingQueue).length;
  const reviewing = patients.filter(belongsToMemedProcessingQueue).length;
  const ready = patients.filter(belongsToReadyPrescriptionQueue).length;
  const delivered = patients.filter((patient) => patient.status === 'delivered').length;

  return [
    { id: 'waiting', label: 'Fila de espera', value: String(waiting), hint: 'Pacientes pagos aguardando triagem medica', tone: 'blue' },
    { id: 'reviewing', label: 'Em atendimento', value: String(reviewing), hint: 'Casos abertos para decisao clinica', tone: 'gold' },
    { id: 'ready', label: 'Receitas prontas', value: String(ready), hint: 'Prontas para visualizacao e envio', tone: 'green' },
    { id: 'delivered', label: 'Entregues', value: String(delivered), hint: 'Receitas ja enviadas ao paciente', tone: 'green' },
  ];
}

function withStatus(
  patients: Patient[],
  patientId: string,
  status: Patient['status'],
  lastPrescription?: string,
  options?: { syncApi?: boolean },
) {
  if (options?.syncApi !== false) {
    void updatePatientStatus(patientId, status);
  }

  return patients.map((patient) =>
    patient.id === patientId
      ? { ...patient, status, lastPrescription: lastPrescription ?? patient.lastPrescription }
      : patient,
  );
}

export const useDashboardStore = create<DashboardStore>((set) => ({
  patients: initialPatients,
  supportPatients: [],
  metrics: buildMetrics(initialPatients),
  loading: false,
  usingMockFallback: false,
  supportUsingMockFallback: false,
  error: null,
  loadPatients: async () => {
    set({ loading: true, error: null });
    const [medicalResult, supportResult] = await Promise.all([getPatients(), getSupportPatients()]);

    set({
      patients: medicalResult.data,
      supportPatients: supportResult.data,
      metrics: buildMetrics(medicalResult.data),
      loading: false,
      usingMockFallback: medicalResult.usingMockFallback,
      supportUsingMockFallback: supportResult.usingMockFallback,
      error: medicalResult.error || supportResult.error || null,
    });
  },
  startReview: (patientId) =>
    set((state) => {
      const patients = withStatus(state.patients, patientId, 'under_review');

      return { patients, metrics: buildMetrics(patients) };
    }),
  approvePrescription: (patientId) =>
    set((state) => {
      const patients = withStatus(state.patients, patientId, 'ready', 'Agora');

      return { patients, metrics: buildMetrics(patients) };
    }),
  acceptMemedPrescription: (patientId) =>
    set((state) => {
      const patients = withStatus(state.patients, patientId, 'ready', 'Agora');

      return { patients, metrics: buildMetrics(patients) };
    }),
  approveMedicalRecord: async (patientId, payload) => {
    const result = await approveClinicalDecision(patientId, {
      notes: payload?.notes,
      observacao_medica: payload?.notes,
      conduta_medica: payload?.conduta_medica,
      dados_clinicos: payload?.dados_clinicos,
    });

    if (result.usingMockFallback) {
      throw new Error(result.error || 'Não foi possível aprovar o atendimento na API.');
    }

    set((state) => {
      const patients = withStatus(state.patients, patientId, 'memed_processing', undefined, { syncApi: false });
      return {
        patients,
        metrics: buildMetrics(patients),
        error: result.memedWarning ? result.memedWarning : state.error,
      };
    });
  },
  rejectMedicalRecord: async (patientId, payload) => {
    const result = await rejectClinicalDecision(patientId, {
      notes: payload?.notes,
      observacao_medica: payload?.notes,
      motivo: payload?.motivo,
      mensagem_whatsapp: payload?.mensagem_whatsapp,
      dados_clinicos: payload?.dados_clinicos,
    });

    if (result.usingMockFallback) {
      throw new Error(result.error || 'Não foi possível reprovar o atendimento na API.');
    }

    set((state) => {
      const patients = withStatus(state.patients, patientId, 'rejected', undefined, { syncApi: false });
      return {
        patients,
        metrics: buildMetrics(patients),
        error: state.error,
      };
    });
  },
  sendPrescription: async (patientId, channel) => {
    const result = await sendPrescriptionDelivery(patientId, channel);

    if (result.usingMockFallback || !result.data.sent) {
      throw new Error(result.error || `Não foi possível enviar a receita por ${channel}.`);
    }

    let updatedChannels: DeliveryChannel[] = [];

    set((state) => {
      const patients = state.patients.map((patient) => {
        if (patient.id !== patientId) return patient;

        const sentDeliveryChannels = Array.from(new Set([...(patient.sentDeliveryChannels || []), channel]));
        updatedChannels = sentDeliveryChannels;

        const clinicalData = {
          ...(patient.clinicalData || {}),
          entregas_receita: [
            {
              channel,
              status: 'sent',
              sent_at: new Date().toISOString(),
            },
            ...(Array.isArray(patient.clinicalData?.entregas_receita) ? patient.clinicalData.entregas_receita : []),
          ],
        };

        return {
          ...patient,
          sentDeliveryChannels,
          clinicalData,
          status: 'delivered' as const,
        };
      });

      return { patients, metrics: buildMetrics(patients) };
    });

    return updatedChannels;
  },
}));
