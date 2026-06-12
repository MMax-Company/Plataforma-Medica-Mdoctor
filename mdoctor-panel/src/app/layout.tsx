import type { Metadata, Viewport } from 'next';
import { AuthSessionBootstrap } from '@/components/auth/AuthSessionBootstrap';
import { StagingBuildMarker } from '@/components/staging/StagingBuildMarker';
import './globals.css';

export const metadata: Metadata = {
  title: 'Doctor Prescreve',
  description: 'Painel Médico',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="staging-audit-body min-h-screen">
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function() {
  var style = document.createElement('style');
  style.textContent = '@media print { * { display: none !important; visibility: hidden !important; } @page { margin: 0; size: 0; } }';
  document.head.appendChild(style);

  window.addEventListener('beforeprint', function(e) {
    e.preventDefault();
    e.stopPropagation();
    console.log('[Print Blocker] beforeprint bloqueado');
    return false;
  }, true);

  window.print = function() {
    console.log('[Print Blocker] window.print bloqueado');
    return false;
  };
})();
            `
          }}
        />
        <AuthSessionBootstrap />
        <StagingBuildMarker />
        {children}
      </body>
    </html>
  );
}
