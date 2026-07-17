/* Página de pagamento da sessão Typebot (WhatsApp -> web).
   Mesmo PaymentIntent criado pelo bloco Stripe do Typebot: nenhuma cobrança
   nova é criada aqui; a confirmação server-side acontece no /complete. */
(function () {
  const token = window.location.pathname.split('/').filter(Boolean).pop();
  const statusEl = document.getElementById('status');
  const amountEl = document.getElementById('amount');
  const payButton = document.getElementById('pay-button');

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = 'status' + (cls ? ' ' + cls : '');
  }

  async function completeOnServer() {
    const res = await fetch(`/api/typebot-payment/${encodeURIComponent(token)}/complete`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.code === 'NOT_PAID' ? 'Pagamento ainda não confirmado pelo Stripe.' : 'Falha ao retomar o atendimento.');
    }
    return data;
  }

  async function init() {
    const res = await fetch(`/api/typebot-payment/${encodeURIComponent(token)}/config`);
    const config = await res.json().catch(() => ({}));
    if (!res.ok || !config.success) {
      setStatus(res.status === 410 ? 'Este link de pagamento expirou. Volte ao WhatsApp e reenvie sua última resposta.' : 'Link de pagamento inválido.', 'error');
      return;
    }
    amountEl.textContent = config.amountLabel || '';

    if (config.status === 'completed') {
      payButton.style.display = 'none';
      setStatus('✅ Pagamento já confirmado. Continue seu atendimento no WhatsApp.', 'ok');
      return;
    }

    const stripe = Stripe(config.publicKey);
    const elements = stripe.elements({ clientSecret: config.clientSecret, locale: 'pt-BR' });
    const paymentElement = elements.create('payment');
    paymentElement.mount('#payment-element');
    paymentElement.on('ready', function () {
      payButton.disabled = false;
      setStatus('');
    });

    payButton.addEventListener('click', async function () {
      payButton.disabled = true;
      setStatus('Processando pagamento…');
      const result = await stripe.confirmPayment({ elements, redirect: 'if_required' });
      if (result.error) {
        setStatus(result.error.message || 'Não foi possível processar o pagamento.', 'error');
        payButton.disabled = false;
        return;
      }
      setStatus('Pagamento aprovado. Retomando seu atendimento…');
      try {
        await completeOnServer();
        payButton.style.display = 'none';
        setStatus('✅ Pagamento confirmado! Volte ao WhatsApp para continuar o atendimento.', 'ok');
      } catch (err) {
        setStatus(err.message + ' Recarregue a página para tentar novamente.', 'error');
        payButton.disabled = false;
      }
    });
  }

  init().catch(function () {
    setStatus('Erro ao carregar o pagamento. Recarregue a página.', 'error');
  });
})();
