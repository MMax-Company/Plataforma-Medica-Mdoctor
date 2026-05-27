'use client';

import { create } from 'zustand';
import { sendPrescriptionWhatsApp } from '@/services/prescriptions';
import { getMockPatients, getPatients, updatePatientStatus } from '@/services/patients';
import type { Patient, PanelMetric } from '@/types/panel';

const initialPatients = getMockPatients();

interface DashboardStore {
  patients: Patient[];
  metrics: PanelMetric[];
  loading: boolean;
  usingMockFallback: boolean;
  error: string | null;
  loadPatients: () => Promise<void>;
  startReview: (patientId: string) => void;
  approvePrescription: (patientId: string) => void;
  acceptMemedPrescription: (patientId: string) => void;
  approveMedicalRecord: (patientId: string) => void;
  rejectMedicalRecord: (patientId: string) => void;
  sendWhatsApp: (patientId: string) => Promise<void>;
}

function buildMetrics(patients: Patient[]): PanelMetric[] {
  const waiting = patients.filter((patient) => patient.status === 'waiting').length;
  const reviewing = patients.filter(
    (patient) => patient.status === 'under_review' || patient.status === 'memed_processing',
  ).length;
  const ready = patients.filter((patient) => patient.status === 'ready').length;
  const delivered = patients.filter((patient) => patient.status === 'delivered').length;

  return [
    { id: 'waiting', label: 'Fila de espera', value: String(waiting), hint: 'Pacientes pagos aguardando triagem medica', tone: 'blue' },
    { id: 'reviewing', label: 'Em atendimento', value: String(reviewing), hint: 'Casos abertos para decisao clinica', tone: 'gold' },
    { id: 'ready', label: 'Receitas prontas', value: String(ready), hint: 'Prontas para visualizacao e envio', tone: 'green' },
    { id: 'delivered', label: 'Entregues', value: String(delivered), hint: 'Receitas ja enviadas ao paciente', tone: 'green' },
  ];
}

function withStatus(patients: Patient[], patientId: string, status: Patient['status'], lastPrescription?: string) {
  void updatePatientStatus(patientId, status);

  return patients.map((patient) =>
    patient.id === patientId
      ? { ...patient, status, lastPrescription: lastPrescription ?? patient.lastPrescription }
      : patient,
  );
}

export const useDashboardStore = create<DashboardStore>((set) => ({
  patients: initialPatients,
  metrics: buildMetrics(initialPatients),
  loading: false,
  usingMockFallback: false,
  error: null,
  loadPatients: async () => {
    set({ loading: true, error: null });
    const result = await getPatients();

    set({
      patients: result.data,
      metrics: buildMetrics(result.data),
      loading: false,
      usingMockFallback: result.usingMockFallback,
      error: result.error || null,
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
  approveMedicalRecord: (patientId) =>
    set((state) => {
      const patients = withStatus(state.patients, patientId, 'memed_processing');

      return { patients, metrics: buildMetrics(patients) };
    }),
  rejectMedicalRecord: (patientId) =>
    set((state) => {
      const patients = withStatus(state.patients, patientId, 'rejected');

      return { patients, metrics: buildMetrics(patients) };
    }),
  sendWhatsApp: async (patientId) => {
    await sendPrescriptionWhatsApp(patientId);
    set((state) => {
      const patients = state.patients.map((patient) =>
        patient.id === patientId ? { ...patient, source: 'WhatsApp' as const, status: 'delivered' as const } : patient,
      );

      return { patients, metrics: buildMetrics(patients) };
    });
  },
}));
