'use client';

import { ProntuarioMedicalHeader } from '@/components/medical-record/ProntuarioMedicalHeader';

interface MedicalRecordHeaderProps {
  onLogout: () => void;
}

export function MedicalRecordHeader({ onLogout }: MedicalRecordHeaderProps) {
  return <ProntuarioMedicalHeader onLogout={onLogout} />;
}
