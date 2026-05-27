'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { MemedProcessingHeader } from '@/components/memed/MemedProcessingHeader';
import { MemedStatusPanel } from '@/components/memed/MemedStatusPanel';
import { PrescriptionActions } from '@/components/memed/PrescriptionActions';
import { PrescriptionPreview } from '@/components/memed/PrescriptionPreview';
import { Badge } from '@/components/ui/badge';
import { getAuthToken } from '@/services/auth.service';
import { getPrescriptionByPatient, validatePrescription } from '@/services/prescriptions';
import { useDashboardStore } from '@/stores/useDashboardStore';
import type { MemedStatusItem, MockPrescription } from '@/types/memed';
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
  status: 'memed_processing',
  risk: 'medium',
  source: 'Typebot',
  paymentStatus: 'paid',
  lastPrescription: '12/04/2026',
};

const statusItems: MemedStatusItem[] = [
  {
    id: 'certificate',
    label: 'Certificado digital conectado',
    description: 'Assinatura digital do médico disponível para emissão da receita.',
    status: 'connected',
  },
  {
    id: 'generation',
    label: 'Aguardando geração da receita',
    description: 'Pré-validação visual concluída. Integração real com Memed será feita na próxima etapa.',
    status: 'waiting',
  },
  {
    id: 'preview',
    label: 'Preview mockado disponível',
    description: 'Documento operacional criado para conferência antes da liberação.',
    status: 'generated',
  },
];

function buildFallbackPrescription(patient: Patient): MockPrescription {
  return {
    id: `RX-${patient.id.toUpperCase()}`,
    patient,
    medication: patient.requestedMedication,
    dosage: 'Conforme posologia padrão e avaliação médica',
    instructions:
      'Utilizar conforme orientação médica. Procurar atendimento presencial em caso de piora, reação adversa ou sintomas de alarme.',
    duration: '30 dias',
    issuedBy: 'Dr. Max Matos',
    createdAt: 'Hoje',
  };
}

export default function MemedProcessingPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const patientId = params.id;
  const { patients, loading, loadPatients, acceptMemedPrescription } = useDashboardStore();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [prescription, setPrescription] = useState<MockPrescription | null>(null);
  const [loadingPrescription, setLoadingPrescription] = useState(true);
  const [prescriptionFallback, setPrescriptionFallback] = useState(false);
  const [prescriptionWarning, setPrescriptionWarning] = useState<string | null>(null);
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
  const patient = patientFromStore || { ...fallbackPatient, id: patientId };

  useEffect(() => {
    let active = true;

    setLoadingPrescription(true);
    void getPrescriptionByPatient(patient.id).then((result) => {
      if (active) {
        setPrescription(result.data);
        setPrescriptionFallback(result.usingMockFallback);
        setPrescriptionWarning(result.error || null);
        setLoadingPrescription(false);
      }
    });

    return () => {
      active = false;
    };
  }, [patient.id]);

  const backToMedicalRecord = () => router.push(`/prontuario/${patient.id}`);

  const acceptPrescription = async () => {
    const result = await validatePrescription(patient.id);
    setPrescriptionFallback(result.usingMockFallback);
    setPrescriptionWarning(result.error || null);
    acceptMemedPrescription(patient.id);
    router.push('/dashboard');
  };

  return (
    <main className="min-h-screen bg-[#F8FAFC] text-[#1E1E1E]">
      <MemedProcessingHeader patientName={patient.name} onBack={backToMedicalRecord} />

      <div className="mx-auto max-w-[1280px] space-y-6 p-6">
        <section className="flex flex-col gap-3 rounded-lg border border-[#E5EAF2] bg-white p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#1557FF]">Validação de receita</p>
            <h2 className="mt-1 text-2xl font-semibold text-[#1E1E1E]">Prescrição Digital Memed</h2>
            <p className="mt-2 max-w-2xl text-sm text-[#5B6475]">
              Etapa visual mockada para revisar a receita antes de integrar certificado, SDK Memed e entrega final.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="green">Certificado digital conectado</Badge>
            <Badge tone="gold">Aguardando geração da receita</Badge>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
          <MemedStatusPanel items={statusItems} />

          <div className="space-y-5">
            {loadingPrescription && (
              <div className="rounded-lg border border-[#E5EAF2] bg-white px-4 py-3 text-sm font-semibold text-[#5B6475]">
                Carregando receita...
              </div>
            )}
            {prescriptionFallback && prescriptionWarning && (
              <div className="rounded-lg border border-[#FFF0BF] bg-[#FFF8E0] px-4 py-3 text-sm font-semibold text-[#8A6200]">
                {prescriptionWarning}
              </div>
            )}
            {patientNotFound && (
              <div className="rounded-lg border border-[#FFF0BF] bg-[#FFF8E0] px-4 py-3 text-sm font-semibold text-[#8A6200]">
                Paciente não encontrado na API local. Exibindo receita simulada para continuidade do fluxo.
              </div>
            )}
            <PrescriptionPreview
              prescription={prescription ?? buildFallbackPrescription(patient)}
              expanded={previewOpen}
              simulated={prescriptionFallback || !prescription}
            />
            <PrescriptionActions
              onView={() => setPreviewOpen((current) => !current)}
              onAccept={acceptPrescription}
              onBack={backToMedicalRecord}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
