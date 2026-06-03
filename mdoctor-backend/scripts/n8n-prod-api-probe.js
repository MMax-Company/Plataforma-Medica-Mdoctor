#!/usr/bin/env node
/** GET /api/v1/workflows — só imprime status (sem vazar chave). */
const base = String(process.env.N8N_BASE_URL || '').replace(/\/$/, '');
const key = String(process.env.N8N_API_KEY || '').trim();
if (!base || !key) {
  console.error('N8N_BASE_URL e N8N_API_KEY obrigatórios');
  process.exit(1);
}
fetch(`${base}/api/v1/workflows?limit=1`, {
  headers: { 'X-N8N-API-KEY': key, accept: 'application/json' }
})
  .then(async (r) => {
    console.log(JSON.stringify({ status: r.status, ok: r.ok }));
    process.exit(r.ok ? 0 : 1);
  })
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
