'use client';

import { MedicalPanelHeader } from '@/components/medical/MedicalPanelHeader';

interface MedicalRecordHeaderProps {
  onLogout: () => void;
}

export function MedicalRecordHeader({ onLogout }: MedicalRecordHeaderProps) {
  return <MedicalPanelHeader onLogout={onLogout} compact />;
}
