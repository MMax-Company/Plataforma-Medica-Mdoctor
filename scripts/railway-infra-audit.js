/**
 * Read-only Railway infrastructure audit (no mutations).
 * Outputs service inventory JSON to stdout.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RAILWAY_ENV = {
  ...process.env,
  RAILWAY_CALLER: 'skill:use-railway@1.2.1'
};

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, env: RAILWAY_ENV }).trim();
}

function runJson(cmd) {
  const out = run(cmd);
  if (!out) return null;
  return JSON.parse(out);
}

function gql(query, variables = {}) {
  const configPath = path.join(process.env.USERPROFILE || process.env.HOME, '.railway', 'config.json');
  const token = JSON.parse(fs.readFileSync(configPath, 'utf8')).user?.token;
  if (!token) throw new Error('Railway token missing');
  const payload = JSON.stringify({ query, variables });
  const tmp = path.join(require('os').tmpdir(), `railway-audit-${Date.now()}.json`);
  fs.writeFileSync(tmp, payload);
  try {
    const raw = run(
      `curl -s https://backboard.railway.com/graphql/v2 -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" --data-binary @${tmp.replace(/\\/g, '/')}`
    );
    const parsed = JSON.parse(raw);
    if (parsed.errors?.length) throw new Error(parsed.errors.map((e) => e.message).join('; '));
    return parsed.data;
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

const PROJECTS = runJson('railway list --json');

const SERVICE_DETAIL_QUERY = `
query ServiceDetail($projectId: String!, $environmentId: String!, $serviceId: String!) {
  project(id: $projectId) {
    name
    service(id: $serviceId) {
      id
      name
      serviceInstances(environmentId: $environmentId) {
        edges {
          node {
            id
            domains {
              serviceDomains { domain }
              customDomains { domain }
            }
            source {
              repo
              image
            }
            latestDeployment {
              id
              status
              createdAt
              meta
            }
          }
        }
      }
    }
  }
}
`;

const ENV_VARS_QUERY = `
query EnvVars($projectId: String!, $environmentId: String!, $serviceId: String!) {
  variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
}
`;

async function main() {
  const inventory = [];

  for (const project of PROJECTS) {
    const envs = project.environments.edges.map((e) => e.node);
    const services = project.services.edges.map((e) => e.node);

    for (const env of envs) {
      const statuses = runJson(`railway service status -p ${project.id} -e ${env.name} --all --json`);
      const statusById = new Map((statuses || []).map((s) => [s.id, s]));

      for (const service of services) {
        const status = statusById.get(service.id);
        const deployed = Boolean(status);
        let detail = null;
        let variableKeys = [];

        if (deployed) {
          try {
            detail = gql(SERVICE_DETAIL_QUERY, {
              projectId: project.id,
              environmentId: env.id,
              serviceId: service.id
            });
          } catch (error) {
            detail = { error: error.message };
          }
          try {
            const vars = gql(ENV_VARS_QUERY, {
              projectId: project.id,
              environmentId: env.id,
              serviceId: service.id
            });
            variableKeys = Object.keys(vars?.variables || {}).sort();
          } catch {
            variableKeys = [];
          }
        }

        const instance = detail?.project?.service?.serviceInstances?.edges?.[0]?.node;
        const railwayDomains = instance?.domains?.serviceDomains?.map((d) => d.domain) || [];
        const customDomains = instance?.domains?.customDomains?.map((d) => d.domain) || [];
        const repo = instance?.source?.repo || null;
        const image = instance?.source?.image || null;
        const deployment = instance?.latestDeployment;

        inventory.push({
          project: project.name,
          projectId: project.id,
          environment: env.name,
          environmentId: env.id,
          service: service.name,
          serviceId: service.id,
          deployedInEnv: deployed,
          deploymentStatus: status?.status || (deployed ? 'UNKNOWN' : 'NOT_DEPLOYED'),
          stopped: status?.stopped ?? null,
          urls: [...railwayDomains, ...customDomains].map((d) => `https://${d}`),
          repo,
          image,
          latestDeploymentId: deployment?.id || status?.deploymentId || null,
          latestDeploymentAt: deployment?.createdAt || null,
          variableKeyCount: variableKeys.length,
          variableKeys: variableKeys.filter((k) => !/SECRET|KEY|PASS|TOKEN|PASSWORD/i.test(k) || /^(NODE_ENV|ENVIRONMENT_NAME|DATA_ENV|FLOW_ENV|WHATSAPP_|N8N_|BACKEND_|CORS_|BASE_URL|PORT|MEMED_|SUPABASE_URL)/.test(k)).slice(0, 40),
          sensitiveKeyNames: variableKeys.filter((k) => /SECRET|KEY|PASS|TOKEN|PASSWORD|API_KEY/i.test(k))
        });
      }
    }
  }

  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), inventory }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
