function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function hasValue(name) {
  return Boolean(String(process.env[name] || '').trim());
}

function minLength(name, length) {
  return String(process.env[name] || '').length >= length;
}

function check(name, ok, message, severity = 'fail') {
  return { name, ok: Boolean(ok), message, severity };
}

function hasTwilioFor(channel) {
  const hasAuth = hasValue('TWILIO_ACCOUNT_SID') && hasValue('TWILIO_AUTH_TOKEN');
  if (channel === 'whatsapp') return hasAuth && (hasValue('TWILIO_WHATSAPP_FROM') || hasValue('TWILIO_FROM_WHATSAPP'));
  if (channel === 'sms') return hasAuth && (hasValue('TWILIO_SMS_FROM') || hasValue('TWILIO_PHONE_NUMBER'));
  return false;
}

function hasEmailProvider() {
  return hasValue('RESEND_API_KEY') && (hasValue('RESEND_FROM_EMAIL') || hasValue('EMAIL_FROM'));
}

function allowsDefaultMedicalPassword() {
  return process.env.ALLOW_DEFAULT_MEDICO_PASS === 'true';
}

function hasDeliveryProvider() {
  return hasTwilioFor('whatsapp') || hasTwilioFor('sms') || hasEmailProvider();
}

function allowsProductionDeliveryMock() {
  return process.env.ALLOW_PRODUCTION_DELIVERY_MOCK === 'true' && process.env.DELIVERY_MOCK_ENABLED === 'true';
}

function getReadinessReport() {
  const production = isProduction();
  const { getSupabaseStatus } = require('./supabase');
  const corsOrigins = String(process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const checks = [
    check('node_env', production, 'NODE_ENV deve ser production no ambiente final', 'warning'),
    check('jwt_secret', hasValue('JWT_SECRET') && minLength('JWT_SECRET', 32), 'JWT_SECRET obrigatório e com pelo menos 32 caracteres'),
    check('medico_user', hasValue('MEDICO_USER'), 'MEDICO_USER obrigatório'),
    check(
      'medico_pass',
      hasValue('MEDICO_PASS') && (process.env.MEDICO_PASS !== 'admin123' || allowsDefaultMedicalPassword()),
      'MEDICO_PASS não pode usar senha padrão sem ALLOW_DEFAULT_MEDICO_PASS=true'
    ),
    check('cors_origin', corsOrigins.length > 0 && !corsOrigins.includes('*'), 'CORS_ORIGIN deve apontar para domínio(s) explícito(s), sem wildcard'),
    check('supabase_url', hasValue('SUPABASE_URL'), 'SUPABASE_URL obrigatório'),
    check(
      'supabase_service_key',
      hasValue('SUPABASE_SERVICE_ROLE_KEY') || hasValue('SUPABASE_SERVICE_KEY'),
      'Service key do Supabase obrigatória'
    ),
    check(
      'local_db_fallback_disabled',
      !production || process.env.DISABLE_LOCAL_DB_FALLBACK === 'true',
      'DISABLE_LOCAL_DB_FALLBACK=true obrigatório em produção para impedir fallback local'
    ),
    check(
      'memed_credentials',
      hasValue('MEMED_API_KEY') && hasValue('MEMED_SECRET_KEY'),
      'Credenciais Memed obrigatórias para prescrição em produção'
    ),
    check(
      'memed_environment',
      (process.env.MEMED_ENVIRONMENT || process.env.MEMED_ENV) === 'production',
      'MEMED_ENVIRONMENT deve ser production no ambiente final',
      'warning'
    ),
    check(
      'delivery_provider',
      hasDeliveryProvider() || allowsProductionDeliveryMock(),
      'Configure Twilio/Resend ou habilite ALLOW_PRODUCTION_DELIVERY_MOCK=true com DELIVERY_MOCK_ENABLED=true'
    )
  ];

  const failures = checks.filter((item) => !item.ok && item.severity === 'fail');
  const warnings = checks.filter((item) => !item.ok && item.severity === 'warning');
  const status = failures.length ? 'fail' : warnings.length ? 'warning' : 'ok';

  return {
    status,
    production,
    storage: getSupabaseStatus(),
    checkedAt: new Date().toISOString(),
    checks,
    failures,
    warnings
  };
}

function assertProductionReady() {
  if (!isProduction()) return getReadinessReport();
  const report = getReadinessReport();
  if (report.failures.length) {
    const details = report.failures.map((item) => item.message).join('; ');
    throw new Error(`Configuração de produção incompleta: ${details}`);
  }
  return report;
}

module.exports = {
  assertProductionReady,
  getReadinessReport
};
