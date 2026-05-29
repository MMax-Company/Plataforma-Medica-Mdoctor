import { MedicalPanelHeader } from '@/components/medical/MedicalPanelHeader';

interface HeaderProps {
  onLogout: () => void;
  onOpenMedicalRecord: () => void;
}

export function Header({ onLogout, onOpenMedicalRecord }: HeaderProps) {
  return <MedicalPanelHeader onLogout={onLogout} onOpenMedicalRecord={onOpenMedicalRecord} />;
}
