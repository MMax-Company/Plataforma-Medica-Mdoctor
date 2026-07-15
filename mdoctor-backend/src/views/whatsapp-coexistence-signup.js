const logEl = document.getElementById('log');
const btn = document.getElementById('loginBtn');
const tokenInput = document.getElementById('adminToken');

function log(line) {
  logEl.textContent += `\n${new Date().toISOString()} ${line}`;
}

let appConfig = null;

async function loadConfig() {
  try {
    const res = await fetch('/api/admin/whatsapp/coexistence/config');
    appConfig = await res.json();
    if (!appConfig.success || !appConfig.embeddedSignupConfigured) {
      btn.textContent = 'Configuração pendente na Meta (ver AÇÃO MANUAL)';
      log(`config indisponível: ${JSON.stringify(appConfig.configuredParts || {})}`);
      return;
    }
    btn.textContent = 'Conectar número via WhatsApp Business App';
    btn.disabled = false;
    log('Configuração carregada — botão habilitado.');
    window.initFacebookSdk(appConfig.appId, appConfig.graphApiVersion);
  } catch (err) {
    log(`falha ao carregar config: ${err.message}`);
  }
}

window.initFacebookSdk = function (appId, apiVersion) {
  window.fbAsyncInit = function () {
    FB.init({ appId, autoLogAppEvents: false, xfbml: false, version: apiVersion });
    log('Facebook SDK inicializado (Embedded Signup v4).');
  };
  (function (d, s, id) {
    if (d.getElementById(id)) return;
    const js = d.createElement(s);
    js.id = id;
    js.src = 'https://connect.facebook.net/pt_BR/sdk.js';
    js.async = true;
    js.defer = true;
    d.body.appendChild(js);
  })(document, 'script', 'facebook-jssdk');
};

// Escuta os eventos oficiais de sessão do Embedded Signup (WA_EMBEDDED_SIGNUP).
// https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users
let capturedIdentity = { phoneNumberId: null, wabaId: null, businessId: null };

window.addEventListener('message', (event) => {
  if (!event.origin || !event.origin.endsWith('facebook.com')) return;
  let data;
  try {
    data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
  } catch {
    return;
  }
  if (!data || data.type !== 'WA_EMBEDDED_SIGNUP') return;

  if (data.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') {
    capturedIdentity = {
      phoneNumberId: data.data?.phone_number_id || null,
      wabaId: data.data?.waba_id || null,
      businessId: data.data?.business_id || null
    };
    log(`FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING recebido (version=${data.version ?? 'desconhecida'}). waba_id presente: ${Boolean(capturedIdentity.wabaId)}, phone_number_id presente: ${Boolean(capturedIdentity.phoneNumberId)}.`);
  } else if (data.event === 'CANCEL') {
    log(`CANCEL recebido no passo "${data.data?.current_step || 'desconhecido'}".`);
  } else if (data.event === 'ERROR') {
    log(`ERROR recebido: ${data.data?.error_message || 'sem detalhes'}.`);
  }
});

btn.addEventListener('click', () => {
  if (!appConfig?.embeddedSignupConfigId) {
    log('config_id ausente — não é possível abrir o fluxo.');
    return;
  }
  const receivedAt = Date.now();
  FB.login(
    (response) => {
      const code = response?.authResponse?.code;
      if (!code) {
        log('FB.login não retornou authorization code (usuário cancelou ou negou).');
        return;
      }
      const elapsedMs = Date.now() - receivedAt;
      log(`authorization code recebido (${elapsedMs}ms desde o clique) — enviando ao backend imediatamente (válido ~30s).`);
      exchangeCode(code);
    },
    {
      config_id: appConfig.embeddedSignupConfigId,
      response_type: 'code',
      override_default_response_type: true,
      extras: {
        setup: {},
        featureType: 'whatsapp_business_app_onboarding',
        sessionInfoVersion: '3'
      }
    }
  );
});

async function exchangeCode(code) {
  const token = tokenInput.value.trim();
  if (!token) {
    log('token de admin não informado — não é possível chamar o backend.');
    return;
  }
  try {
    const res = await fetch('/api/admin/whatsapp/coexistence/exchange-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code, ...capturedIdentity })
    });
    const body = await res.json();
    log(`troca de code: HTTP ${res.status} — ${JSON.stringify({ success: body.success, exchanged: body.exchanged, error: body.error || null })}`);
  } catch (err) {
    log(`falha ao chamar backend: ${err.message}`);
  }
}

loadConfig();
