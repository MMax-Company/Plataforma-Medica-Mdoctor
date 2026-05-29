/**
 * n8n Code node: monta resposta Typebot após POST /api/webhook/triagem
 */
const item = $input.first();
const json = item.json || {};
let statusCode = item.statusCode || json.statusCode || 200;
let body = json;

if (json.body !== undefined) {
  try {
    body = typeof json.body === 'string' ? JSON.parse(json.body) : json.body;
  } catch {
    body = { raw: json.body };
  }
}

const ctx = $('Build Payload').first().json;
const httpOk = Number(statusCode) >= 200 && Number(statusCode) < 300;
const apiSuccess = body?.success !== false && !body?.error;
const ok = httpOk && apiSuccess;

const atendimentoId =
  body?.atendimentoId || body?.atendimento_id || body?.atendimento?.id || body?.id || null;

return [
  {
    json: {
      ok,
      statusCode: Number(statusCode),
      correlationId: ctx.correlationId,
      typebotResponse: ok
        ? {
            success: true,
            message: body?.message || 'Triagem recebida com sucesso',
            atendimentoId
          }
        : {
            success: false,
            message: body?.message || body?.error || 'Erro ao processar triagem'
          }
    }
  }
];
