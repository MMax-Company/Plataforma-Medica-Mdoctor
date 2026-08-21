/* Página auxiliar do pagamento Typebot/WhatsApp.
   A confirmação real ocorre via webhook Stripe; esta página apenas orienta o paciente. */
(function () {
  const token = window.location.pathname.split('/').filter(Boolean).pop();
  const statusEl = document.getElementById('status');
  const amountEl = document.getElementById('amount');
  const payButton = document.getElementById('pay-button');

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = 'status' + (cls ? ' ' + cls : '');
  }

  async function loadStatus() {
    const res = await fetch(`/api/typebot-payment/${encodeURIComponent(token)}/status`);
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  async function init() {
    const params = new URLSearchParams(window.location.search);
    amountEl.textContent = 'R$ 49,90';

    if (params.get('cancelled') === '1') {
      setStatus('Pagamento cancelado. Volte ao WhatsApp para tentar novamente ou continuar depois.', 'error');
      payButton.style.display = 'none';
      return;
    }

    const { res, data } = await loadStatus();
    if (!res.ok) {
      setStatus(res.status === 410 ? 'Este link expirou. Volte ao WhatsApp e selecione Abrir pagamento novamente.' : 'Link de pagamento inválido.', 'error');
      payButton.style.display = 'none';
      return;
    }

    amountEl.textContent = data.amount_label || 'R$ 49,90';

    if (data.payment_status === 'paid') {
      payButton.style.display = 'none';
      setStatus('Pagamento confirmado. Volte ao WhatsApp para continuar o atendimento.', 'ok');
      return;
    }

    if (params.get('session_id')) {
      setStatus('Recebemos seu pagamento. Aguarde a confirmação automática e volte ao WhatsApp para selecionar Conferir pagamento.', 'ok');
      payButton.textContent = 'Atualizar status';
      payButton.disabled = false;
      payButton.onclick = async function () {
        payButton.disabled = true;
        const refreshed = await loadStatus();
        if (refreshed.data.payment_status === 'paid') {
          setStatus('Pagamento confirmado. Volte ao WhatsApp para continuar o atendimento.', 'ok');
          payButton.style.display = 'none';
          return;
        }
        setStatus('Ainda não recebemos a confirmação do pagamento. Aguarde alguns instantes e tente novamente.', 'error');
        payButton.disabled = false;
      };
      return;
    }

    payButton.textContent = 'Ir para pagamento';
    payButton.disabled = false;
    payButton.onclick = function () {
      window.location.href = `/api/typebot-payment/${encodeURIComponent(token)}/checkout`;
    };
    setStatus('Toque no botão abaixo para abrir o checkout seguro do Stripe.');
  }

  init().catch(function () {
    setStatus('Erro ao carregar o pagamento. Recarregue a página.', 'error');
  });
})();
