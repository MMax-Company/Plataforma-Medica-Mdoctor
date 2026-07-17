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

  function paymentReturnUrl() {
    return window.location.origin + window.location.pathname;
  }

  async function completeOnServer() {
    const res = await fetch(`/api/typebot-payment/${encodeURIComponent(token)}/complete`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.code === 'NOT_PAID' ? 'Pagamento ainda não confirmado pelo Stripe.' : 'Falha ao retomar o atendimento.');
    }
    return data;
  }

  async function finalizeAfterPayment() {
    setStatus('Pagamento aprovado. Retomando seu atendimento…');
    await completeOnServer();
    payButton.style.display = 'none';
    setStatus('✅ Pagamento confirmado! Volte ao WhatsApp para continuar o atendimento.', 'ok');
  }

  async function recoverAfterClientError(stripeError) {
    try {
      await completeOnServer();
      payButton.style.display = 'none';
      setStatus('✅ Pagamento confirmado! Volte ao WhatsApp para continuar o atendimento.', 'ok');
      return true;
    } catch (_) {
      setStatus(stripeError.message || 'Não foi possível processar o pagamento.', 'error');
      payButton.disabled = false;
      return false;
    }
  }

  async function init() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('redirect_status') === 'succeeded') {
      payButton.disabled = true;
      try {
        await finalizeAfterPayment();
      } catch (err) {
        setStatus(err.message + ' Recarregue a página para tentar novamente.', 'error');
        payButton.disabled = false;
      }
      return;
    }

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

    if (config.intentAlreadyPaid) {
      payButton.disabled = true;
      try {
        await finalizeAfterPayment();
      } catch (err) {
        setStatus(err.message + ' Recarregue a página para tentar novamente.', 'error');
        payButton.disabled = false;
      }
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
      const result = await stripe.confirmPayment({
        elements,
        redirect: 'if_required',
        confirmParams: { return_url: paymentReturnUrl() }
      });
      if (result.error) {
        await recoverAfterClientError(result.error);
        return;
      }
      if (result.paymentIntent && result.paymentIntent.status === 'processing') {
        setStatus('Pagamento em processamento. Aguarde a confirmação…');
        payButton.disabled = false;
        return;
      }
      try {
        await finalizeAfterPayment();
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
