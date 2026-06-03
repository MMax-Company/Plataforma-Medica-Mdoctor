import type { ReactNode } from 'react';

export default function LoginLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[100dvh] max-h-[768px] min-h-0 w-full justify-center overflow-hidden bg-[#EEF2F7] antialiased">
      {children}
    </div>
  );
}
