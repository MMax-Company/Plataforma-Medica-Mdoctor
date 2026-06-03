import type { ReactNode } from 'react';

export default function FilaLayout({ children }: { children: ReactNode }) {
  return <div className="flex h-[720px] min-h-[720px] w-full justify-center overflow-hidden bg-[#F6F9FD]">{children}</div>;
}
