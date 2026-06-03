/** Ripple visual em cada clique — facilita auditoria humana em modo headed. */
export const CLICK_HIGHLIGHT_INIT_SCRIPT = `
(() => {
  if (window.__mdoctorClickHighlight) return;
  window.__mdoctorClickHighlight = true;
  document.addEventListener(
    'click',
    (e) => {
      const dot = document.createElement('div');
      dot.setAttribute('data-playwright-click-highlight', '1');
      dot.style.cssText = [
        'position:fixed',
        'z-index:2147483647',
        'width:28px',
        'height:28px',
        'margin:-14px 0 0 -14px',
        'border:3px solid #e11d48',
        'border-radius:50%',
        'background:rgba(225,29,72,0.35)',
        'box-shadow:0 0 12px rgba(225,29,72,0.5)',
        'pointer-events:none',
        'transition:opacity 0.55s ease, transform 0.55s ease',
      ].join(';');
      dot.style.left = e.clientX + 'px';
      dot.style.top = e.clientY + 'px';
      document.body.appendChild(dot);
      requestAnimationFrame(() => {
        dot.style.opacity = '0';
        dot.style.transform = 'scale(1.8)';
      });
      setTimeout(() => dot.remove(), 580);
    },
    true,
  );
})();
`;
