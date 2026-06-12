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
  Object.defineProperty(window, 'print', {
    value: function() { console.log('[Print Blocker] Bloqueado'); return false; },
    writable: false,
    configurable: false
  });

  const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      mutation.addedNodes.forEach(function(node) {
        if (node.tagName === 'IFRAME') {
          try {
            const iframeWindow = node.contentWindow;
            if (iframeWindow) {
              Object.defineProperty(iframeWindow, 'print', {
                value: function() { console.log('[Print Blocker] iframe bloqueado'); return false; },
                writable: false,
                configurable: false
              });
            }
          } catch(e) {
            console.log('[Print Blocker] iframe cross-origin, bloqueando via CSS');
            node.setAttribute('sandbox', 'allow-scripts allow-same-origin');
          }
        }
      });
    });
  });
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

  const style = document.createElement('style');
  style.textContent = '@media print { * { display: none !important; } }';
  document.head.appendChild(style);
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
