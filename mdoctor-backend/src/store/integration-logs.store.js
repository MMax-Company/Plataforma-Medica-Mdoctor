const T = require('../db/tables');
const { dbQuery } = require('../db/persistence');

async function createIntegrationError({ integration, direction = 'inbound', correlationId, error, request = {} }) {
  const row = {
    integration,
    direction,
    status: 'error',
    correlation_id: correlationId || null,
    request_payload: request,
    response_payload: {},
    error_message: String(error?.message || error || 'Erro de integração').slice(0, 2000)
  };
  return dbQuery('registrar erro de integração', async (supabase) =>
    supabase.from(T.INTEGRATION_LOGS).insert(row).select('id').single()
  );
}

module.exports = { createIntegrationError };

