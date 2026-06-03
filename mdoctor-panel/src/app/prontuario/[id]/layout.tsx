import type { ReactNode } from 'react';

export default function ProntuarioLayout({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[768px] w-full justify-center overflow-x-hidden bg-[#F6F9FD]">{children}</div>;
}
