import type { ReactNode } from 'react';

export default function LoginLayout({ children }: { children: ReactNode }) {
  return (
    <div className="login-replica-shell flex min-h-[100dvh] w-full justify-center overflow-x-hidden bg-[#EEF2F7] antialiased">
      {children}
    </div>
  );
}
