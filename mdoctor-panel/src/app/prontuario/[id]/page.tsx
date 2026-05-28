'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { ClinicalBlock } from '@/components/medical-record/ClinicalBlock';
import { DecisionActions } from '@/components/medical-record/DecisionActions';
import { EligibilityBanner } from '@/components/medical-record/EligibilityBanner';
import { MedicalHistoryCard } from '@/components/medical-record/MedicalHistoryCard';
import { MedicalNotes } from '@/components/medical-record/MedicalNotes';
import { MedicalRecordHeader } from '@/components/medical-record/MedicalRecordHeader';
import { PatientDataCard } from '@/components/medical-record/PatientDataCard';
import { Button } from '@/components/ui/button';
import { clearSession } from '@/services/auth.service';
import { getAuthToken } from '@/services/auth.service';
import { useDashboardStore } from '@/stores/useDashboardStore';
import type { MedicalRecord } from '@/types/medical-record';
import type { Patient } from '@/types/panel';

const MOCK_SESSION_KEY = 'mdoctor_panel_mock_session';

const fallbackPatient: Patient = {
  id: 'mock-patient',
  name: 'Camila Rocha',
  age: 34,
  phone: '+55 11 98123-4421',
  condition: 'Enxaqueca recorrente',
  requestedMedication: 'Sumatriptana 50mg',
  submittedAt: '08:42',
  status: 'under_review',
  risk: 'medium',
  source: 'Typebot',
  paymentStatus: 'paid',
  lastPrescription: '12/04/2026',
};

function buildMedicalRecord(patient: Patient): MedicalRecord {
  return {
    id: patient.id,
    patient,
    eligibility: {
      approved: true,
      message: 'Paciente triado com sucesso pelo chatbot. Todos os critérios atendidos.',
      criteria: ['Pagamento confirmado', 'Sem contraindicação crítica', 'Dados clínicos completos'],
    },
    clinicalSummary: {
      chiefComplaint: patient.condition,
      clinicalHistory:
        'Paciente relata quadro compatível com solicitação informada, sem sinais de alarme na triagem automatizada. Evolução estável e indicação de renovação terapêutica conforme histórico declarado.',
      physicalExam:
        'Atendimento remoto. Sem exame físico presencial nesta etapa. Dados subjetivos coletados por chatbot e revisados para decisão médica.',
      allergies: 'Nega alergias medicamentosas relevantes no formulário de triagem.',
      currentMedications: patient.lastPrescription
        ? `${patient.requestedMedication}. Última prescrição registrada: ${patient.lastPrescription}.`
        : `${patient.requestedMedication}. Sem outras medicações informadas.`,
      medicalConduct:
        'Avaliar aderência ao protocolo clínico, confirmar ausência de contraindicações e decidir aprovação, edição ou reprovação do atendimento.',
    },
    medicalHistory: {
      previousConditions: ['Sem internações recentes informadas', 'Sem gestação informada', 'Sem sinais de urgência clínica'],
      previousPrescriptions: [patient.lastPrescription || 'Sem receita anterior no painel', patient.requestedMedication],
      risk: patient.risk,
      chatbotCompletedAt: patient.submittedAt,
    },
    notes: '',
  };
}

export default function MedicalRecordPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const patientId = params.id;
  const { patients, loading, loadPatients, approveMedicalRecord, rejectMedicalRecord } = useDashboardStore();
  const [notes, setNotes] = useState('');
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const attemptedPatientLoad = useRef(false);

  useEffect(() => {
    if (!getAuthToken() && !window.localStorage.getItem(MOCK_SESSION_KEY)) {
      router.replace('/login');
      return;
    }

    const patientInStore = patients.some((item) => item.id === patientId);

    if ((patients.length === 0 || !patientInStore) && !attemptedPatientLoad.current) {
      attemptedPatientLoad.current = true;
      void loadPatients();
    }
  }, [loadPatients, patientId, patients, router]);

  const patientFromStore = patients.find((item) => item.id === patientId);
  const patientNotFound = !loading && !patientFromStore;
  const patient = useMemo(() => patientFromStore || { ...fallbackPatient, id: patientId }, [patientFromStore, patientId]);
  const record = useMemo(() => buildMedicalRecord(patient), [patient]);

  const clinicalBlocks = [
    { title: 'Queixa Principal', content: record.clinicalSummary.chiefComplaint },
    { title: 'Histórico Clínico', content: record.clinicalSummary.clinicalHistory },
    { title: 'Exame Físico', content: record.clinicalSummary.physicalExam },
    { title: 'Alergias', content: record.clinicalSummary.allergies },
    { title: 'Medicações em Uso', content: record.clinicalSummary.currentMedications },
    { title: 'Conduta Médica', content: record.clinicalSummary.medicalConduct },
  ];

  const backToDashboard = () => router.push('/dashboard');
  const logout = () => {
    clearSession();
    window.localStorage.removeItem(MOCK_SESSION_KEY);
    router.replace('/login');
  };

  const rejectAttendance = () => {
    rejectMedicalRecord(patient.id);
    router.push('/dashboard');
  };

  const approveAttendance = () => {
    approveMedicalRecord(patient.id);
    router.push(`/memed/${patient.id}`);
  };

  const showEditNotice = () => {
    setActionMessage('Edição manual do prontuário ficará disponível na próxima etapa.');
    window.setTimeout(() => setActionMessage(null), 3500);
  };

  return (
    <main className="min-h-screen bg-[#F8FAFC] text-[#1E1E1E]">
      <MedicalRecordHeader onLogout={logout} />

      <div className="mx-auto max-w-[1680px] space-y-5 p-4 xl:p-6">
        <section className="space-y-3">
          <Button variant="outline" onClick={backToDashboard} className="h-11 px-4">
            <ArrowLeft className="h-4 w-4" />
            Voltar para painel
          </Button>
          <div className="text-center">
            <h1 className="text-[28px] font-bold tracking-wide text-[#1E1E1E]">PRONTUÁRIO MÉDICO</h1>
            <p className="text-sm text-[#5B6475]">Avalie as informações do paciente e aprove o atendimento</p>
          </div>
        </section>

        {loading && (
          <div className="rounded-lg border border-[#E5EAF2] bg-white px-4 py-3 text-sm font-semibold text-[#5B6475]">
            Carregando prontuario...
          </div>
        )}

        {actionMessage && (
          <div className="rounded-lg border border-[#D9E2F0] bg-white px-4 py-3 text-sm font-semibold text-[#5B6475]">
            {actionMessage}
          </div>
        )}

        {patientNotFound && (
          <div className="rounded-lg border border-[#FFF0BF] bg-[#FFF8E0] px-4 py-3 text-sm font-semibold text-[#8A6200]">
            Paciente não encontrado na API local. Exibindo prontuário simulado para continuidade do fluxo.
          </div>
        )}

        <EligibilityBanner message={record.eligibility.message} criteria={record.eligibility.criteria} />

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
          <div className="space-y-5">
            <PatientDataCard patient={patient} />
          </div>

          <div className="space-y-5">
            <MedicalHistoryCard record={record} />
            <section className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
              {clinicalBlocks.map((block) => (
                <ClinicalBlock key={block.title} title={block.title} content={block.content} />
              ))}
            </section>

            <MedicalNotes value={notes} onChange={(event) => setNotes(event.target.value)} />

            <DecisionActions
              onReject={rejectAttendance}
              onApprove={approveAttendance}
              onEdit={showEditNotice}
              onOpenPrescription={() => router.push(`/memed/${patient.id}`)}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
