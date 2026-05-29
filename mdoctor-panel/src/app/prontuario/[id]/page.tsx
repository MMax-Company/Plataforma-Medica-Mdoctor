'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { AttachedPrescriptionCard } from '@/components/medical-record/AttachedPrescriptionCard';
import { ClinicalBlock } from '@/components/medical-record/ClinicalBlock';
import { DecisionActions } from '@/components/medical-record/DecisionActions';
import { EligibilityBanner } from '@/components/medical-record/EligibilityBanner';
import { MedicalNotes } from '@/components/medical-record/MedicalNotes';
import { MedicalRecordHeader } from '@/components/medical-record/MedicalRecordHeader';
import { PatientDataCard } from '@/components/medical-record/PatientDataCard';
import { Button } from '@/components/ui/button';
import { buildMedicalRecord } from '@/lib/medical-record-builder';
import { CLINICAL_REJECT_WHATSAPP_MESSAGE } from '@/services/clinical-decision';
import { saveClinicalRecord } from '@/services/clinical-record';
import { clearSession, getAuthToken } from '@/services/auth.service';
import { getPatientById } from '@/services/patients';
import { useDashboardStore } from '@/stores/useDashboardStore';
import type { MedicalRecord } from '@/types/medical-record';
import type { Patient } from '@/types/panel';

const MOCK_SESSION_KEY = 'mdoctor_panel_mock_session';

const fallbackPatient: Patient = {
  id: 'mock-patient',
  name: 'Camila Rocha',
  age: 34,
  phone: '+55 11 981234421',
  condition: 'Enxaqueca recorrente',
  requestedMedication: 'Sumatriptana 50mg',
  submittedAt: '08:42',
  status: 'under_review',
  risk: 'medium',
  source: 'Typebot',
  paymentStatus: 'paid',
  cpf: '123.456.789-00',
  email: 'camila.rocha@email.com',
  birthDate: '12/03/1992',
  address: 'Av. Paulista, 1000 - São Paulo/SP',
  eligibility: { eligible: true },
  clinicalData: {
    previous_prescription: true,
    foto_receita_url: 'https://placehold.co/600x800/png?text=Receita+anterior',
    cep: '01310-100',
    queixa_principal: 'Renovação de tratamento para enxaqueca recorrente.',
    historico_clinico: 'Uso contínuo com relato de estabilidade clínica na triagem.',
    exame_fisico_telemedicina: 'Telemedicina assíncrona sem exame presencial nesta etapa.',
    alergias: 'Sem alergias medicamentosas graves relatadas.',
    medicacao_em_uso: 'Sumatriptana 50mg',
    conduta_sugerida: 'Conduta: avaliar renovação conservadora conforme protocolo e documentação enviada.',
  },
};

type ClinicalDraft = MedicalRecord['clinicalSummary'];

export default function MedicalRecordPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const patientId = params.id;
  const { patients, loading, loadPatients, startReview, approveMedicalRecord, rejectMedicalRecord } = useDashboardStore();
  const [resolvedPatient, setResolvedPatient] = useState<Patient | null>(null);
  const [fetchingPatient, setFetchingPatient] = useState(false);
  const [notes, setNotes] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [clinicalDraft, setClinicalDraft] = useState<ClinicalDraft | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [decisionLoading, setDecisionLoading] = useState<'approve' | 'reject' | null>(null);
  const attemptedPatientLoad = useRef(false);
  const startedReview = useRef(false);

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

  useEffect(() => {
    if (patientFromStore) {
      setResolvedPatient(patientFromStore);
      return;
    }

    let cancelled = false;

    async function fetchPatient() {
      setFetchingPatient(true);
      const result = await getPatientById(patientId);
      if (!cancelled && result.data) {
        setResolvedPatient(result.data);
      }
      if (!cancelled) setFetchingPatient(false);
    }

    if (patientId && !patientFromStore) {
      void fetchPatient();
    }

    return () => {
      cancelled = true;
    };
  }, [patientFromStore, patientId]);

  useEffect(() => {
    if (!patientId || startedReview.current) return;
    startedReview.current = true;
    startReview(patientId);
  }, [patientId, startReview]);

  const patient = useMemo(
    () => resolvedPatient || patientFromStore || { ...fallbackPatient, id: patientId },
    [resolvedPatient, patientFromStore, patientId],
  );

  const record = useMemo(() => buildMedicalRecord(patient), [patient]);

  useEffect(() => {
    setClinicalDraft(record.clinicalSummary);
  }, [record]);

  const clinicalBlocks = [
    { key: 'chiefComplaint' as const, title: 'Queixa Principal' },
    { key: 'clinicalHistory' as const, title: 'Histórico Clínico' },
    { key: 'physicalExam' as const, title: 'Exame Físico' },
    { key: 'allergies' as const, title: 'Alergias' },
    { key: 'currentMedications' as const, title: 'Medicações em Uso' },
    { key: 'medicalConduct' as const, title: 'Conduta Médica' },
  ];

  const isLoading = loading || fetchingPatient;
  const patientNotFound = !isLoading && !patientFromStore && !resolvedPatient;

  const backToDashboard = () => router.push('/dashboard');
  const logout = () => {
    clearSession();
    window.localStorage.removeItem(MOCK_SESSION_KEY);
    router.replace('/login');
  };

  const updateClinicalField = (key: keyof ClinicalDraft, value: string) => {
    setClinicalDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  const buildClinicalPayload = () => {
    const summary = clinicalDraft || record.clinicalSummary;
    const optionalNote = notes.trim();

    return {
      queixa_principal: summary.chiefComplaint,
      historico_clinico: summary.clinicalHistory,
      exame_fisico_telemedicina: summary.physicalExam,
      alergias: summary.allergies,
      medicacao_em_uso: summary.currentMedications,
      conduta_medica: summary.medicalConduct,
      conduta_sugerida: summary.medicalConduct,
      observacao_medica: optionalNote || null,
      protocol_version: record.eligibility.protocolVersion,
      ...(patient.clinicalData || {}),
    };
  };

  const persistMedicalRecord = async () => {
    await saveClinicalRecord(patient.id, {
      dados_clinicos: buildClinicalPayload(),
      paciente_nome: patient.name,
      paciente_telefone: patient.phone,
      paciente_cpf: patient.cpf,
      paciente_email: patient.email,
      condicao: patient.condition,
    });
  };

  const rejectAttendance = async () => {
    setDecisionLoading('reject');
    setActionMessage(null);
    try {
      const optionalNote = notes.trim();
      const clinicalPayload = buildClinicalPayload();

      await persistMedicalRecord();
      await rejectMedicalRecord(patient.id, {
        notes: optionalNote || undefined,
        motivo: optionalNote || 'Atendimento reprovado pelo médico no prontuário',
        mensagem_whatsapp: CLINICAL_REJECT_WHATSAPP_MESSAGE,
        dados_clinicos: clinicalPayload,
      });
      await loadPatients();
      setActionMessage('Atendimento reprovado e registrado. Notificação WhatsApp acionada via n8n.');
      router.push('/dashboard');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível reprovar o atendimento.';
      setActionMessage(message);
    } finally {
      setDecisionLoading(null);
    }
  };

  const approveAttendance = async () => {
    setDecisionLoading('approve');
    setActionMessage(null);
    try {
      const conduct = clinicalDraft?.medicalConduct || record.clinicalSummary.medicalConduct;
      const optionalNote = notes.trim();
      const conduta = optionalNote ? `${conduct}\n\nObservação médica: ${optionalNote}` : conduct;
      const clinicalPayload = buildClinicalPayload();

      await persistMedicalRecord();
      await approveMedicalRecord(patient.id, {
        notes: optionalNote || undefined,
        conduta_medica: conduta,
        dados_clinicos: clinicalPayload,
      });
      await loadPatients();
      router.push(`/memed/${patient.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível aprovar o atendimento.';
      setActionMessage(message);
    } finally {
      setDecisionLoading(null);
    }
  };

  return (
    <main className="min-h-screen bg-[#F8FAFC] text-[#1E1E1E]">
      <MedicalRecordHeader onLogout={logout} />

      <div className="mx-auto max-w-[1680px] space-y-5 p-4 xl:p-6">
        <section className="grid grid-cols-1 items-center gap-4 lg:grid-cols-[auto_1fr]">
          <Button variant="outline" onClick={backToDashboard} className="h-11 w-fit px-4">
            <ArrowLeft className="h-4 w-4" />
            Voltar para painel
          </Button>
          <div className="text-center lg:pr-[140px]">
            <h1 className="text-[28px] font-bold tracking-wide text-[#1E1E1E]">PRONTUÁRIO MÉDICO</h1>
            <p className="mt-1 text-sm text-[#5B6475]">
              Avalie as informações do paciente e aprove ou reprove o atendimento.
            </p>
          </div>
        </section>

        {isLoading && (
          <div className="rounded-lg border border-[#E5EAF2] bg-white px-4 py-3 text-sm font-semibold text-[#5B6475]">
            Carregando prontuário...
          </div>
        )}

        {actionMessage && (
          <div className="rounded-lg border border-[#D9E2F0] bg-white px-4 py-3 text-sm font-semibold text-[#5B6475]">
            {actionMessage}
          </div>
        )}

        {patientNotFound && (
          <div className="rounded-lg border border-[#FFF0BF] bg-[#FFF8E0] px-4 py-3 text-sm font-semibold text-[#8A6200]">
            Paciente não encontrado na API. Exibindo prontuário simulado para continuidade do fluxo.
          </div>
        )}

        <EligibilityBanner message={record.eligibility.message} approved={record.eligibility.approved} />

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
          <PatientDataCard patient={patient} />

          <div className="space-y-5">
            <div className="rounded-[20px] border border-[#E5EAF2] bg-white px-4 py-3">
              <h2 className="text-base font-bold text-[#1E1E1E]">HISTÓRIA CLÍNICA</h2>
            </div>

            <section className="grid grid-cols-1 gap-4">
              {clinicalBlocks.map((block) => (
                <ClinicalBlock
                  key={block.key}
                  title={block.title}
                  content={clinicalDraft?.[block.key] || ''}
                  editable={isEditing}
                  onContentChange={(value) => updateClinicalField(block.key, value)}
                />
              ))}
            </section>

            <AttachedPrescriptionCard imageUrl={record.prescriptionImageUrl || null} />

            <MedicalNotes value={notes} onChange={(event) => setNotes(event.target.value)} />

            <DecisionActions
              onReject={() => void rejectAttendance()}
              onApprove={() => void approveAttendance()}
              onEdit={() => setIsEditing((current) => !current)}
              disabled={decisionLoading !== null}
              loadingAction={decisionLoading}
              isEditing={isEditing}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
