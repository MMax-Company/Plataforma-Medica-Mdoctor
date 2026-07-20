/**
 * Origem única do Typebot oficial usado pelo fluxo WhatsApp.
 * Não substituir automaticamente por outro bot se a env estiver errada.
 */
const OFFICIAL_TYPEBOT_PUBLIC_ID = 'doctor-prescreve-8rmljgu';
const OFFICIAL_TYPEBOT_ID = 'higij2z0xihxxkr378rmljgu';
const OFFICIAL_TYPEBOT_PUBLIC_URL = `https://typebot.co/${OFFICIAL_TYPEBOT_PUBLIC_ID}`;

function isStagingEnv(env = process.env) {
  const name = String(env.ENVIRONMENT_NAME || env.NODE_ENV || '').trim().toLowerCase();
  return name === 'staging' || env.RAILWAY_ENVIRONMENT_NAME === 'staging';
}

/**
 * Resolve o publicId oficial para o runtime WhatsApp.
 * - Sem TYPEBOT_PUBLIC_ID → usa o oficial.
 * - Com valor diferente do oficial → erro claro (não substitui).
 */
function resolveWhatsAppTypebotPublicId(env = process.env) {
  const configured = String(env.TYPEBOT_PUBLIC_ID || '').trim();
  if (!configured) return OFFICIAL_TYPEBOT_PUBLIC_ID;

  if (configured !== OFFICIAL_TYPEBOT_PUBLIC_ID) {
    const scope = isStagingEnv(env) ? 'staging' : 'runtime';
    const error = new Error(
      `TYPEBOT_PUBLIC_ID inválido no ${scope} WhatsApp: recebido "${configured}", ` +
        `oficial "${OFFICIAL_TYPEBOT_PUBLIC_ID}". ` +
        'Corrija a variável de ambiente; o fluxo não substitui automaticamente por outro Typebot.'
    );
    error.code = 'TYPEBOT_PUBLIC_ID_MISMATCH';
    throw error;
  }

  return OFFICIAL_TYPEBOT_PUBLIC_ID;
}

function getWhatsAppTypebotOfficialConfig(env = process.env) {
  return {
    publicId: resolveWhatsAppTypebotPublicId(env),
    typebotId: OFFICIAL_TYPEBOT_ID,
    publicUrl: OFFICIAL_TYPEBOT_PUBLIC_URL,
    viewerUrl: String(env.TYPEBOT_VIEWER_URL || '').replace(/\/$/, '')
  };
}

module.exports = {
  OFFICIAL_TYPEBOT_PUBLIC_ID,
  OFFICIAL_TYPEBOT_ID,
  OFFICIAL_TYPEBOT_PUBLIC_URL,
  getWhatsAppTypebotOfficialConfig,
  isStagingEnv,
  resolveWhatsAppTypebotPublicId
};
