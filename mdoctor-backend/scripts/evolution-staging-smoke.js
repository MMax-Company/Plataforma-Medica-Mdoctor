/**
 * Smoke test seguro da Evolution API staging (somente leitura + status).
 * Nao chama connect/restart/logout/delete.
 *
 * Uso:
 *   EVOLUTION_API_URL=... EVOLUTION_API_KEY=... EVOLUTION_INSTANCE=mdoctor-staging node scripts/evolution-staging-smoke.js
 */

const baseUrl = String(process.env.EVOLUTION_API_URL || '').replace(/\/+$/, '');
const apiKey = String(process.env.EVOLUTION_API_KEY || '').trim();
const instance = String(process.env.EVOLUTION_INSTANCE || 'mdoctor-staging').trim();

if (!baseUrl || !apiKey) {
  console.error('Defina EVOLUTION_API_URL e EVOLUTION_API_KEY');
  process.exit(1);
}

const headers = { apikey: apiKey };

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

async function main() {
  const root = await fetch(`${baseUrl}/`);
  const rootData = await root.json().catch(() => ({}));

  const fetchInstances = await getJson('/instance/fetchInstances');
  const connectionState = await getJson(`/instance/connectionState/${encodeURIComponent(instance)}`);

  console.log(
    JSON.stringify(
      {
        baseUrl,
        instance,
        root: { ok: root.ok, version: rootData.version, manager: rootData.manager },
        fetchInstances: { ok: fetchInstances.ok, status: fetchInstances.status },
        connectionState: {
          ok: connectionState.ok,
          status: connectionState.status,
          state: connectionState.data?.instance?.state || null
        }
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
