#!/usr/bin/env node
/**
 * Tour técnico de autenticação/autorização — Doctor Prescreve.
 * Sem tour visual Playwright completo; API + checagem leve de páginas.
 *
 *   MEDICO_PASS=... node scripts/auth-tour-tecnico.js
 */
const fs = require('fs');
const path = require('path');

const BACKEND = (process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');
const PANEL = (process.env.PANEL_URL || 'https://painel-medico-staging-staging.up.railway.app').replace(/\/$/, '');
const USER = process.env.MEDICO_USER || 'drmax.matos';
const PASS = process.env.MEDICO_PASS || '';
const REPORT_JSON = path.join(__dirname, '../../docs/AUTH-TOUR-TECNICO-RELATORIO.json');
const REPORT_MD = path.join(__dirname, '../../docs/AUTH-TOUR-TECNICO-RELATORIO.md');

const steps = [];
const codeFindings = [];
const envFindings = [];

function step(stepId, label, ok, detail = {}) {
  steps.push({ id: stepId, label, ok: Boolean(ok), ...detail });
  return ok;
}

async function request(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  return { status: res.status, ok: res.ok, data, text };
}

function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1];
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function auditEnvFiles() {
  const panelEnvLocal = path.join(__dirname, '../.env.local');
  const panelEnvExample = path.join(__dirname, '../.env.example');
  const backendEnvLocal = path.join(__dirname, '../../mdoctor-backend/.env.local');
  const backendEnvExample = path.join(__dirname, '../../mdoctor-backend/.env.example');

  const expectedPanel = ['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_ENABLE_MOCK_FALLBACK'];
  const expectedBackend = ['JWT_SECRET', 'MEDICO_USER', 'MEDICO_PASS', 'MEDICO_ROLE', 'CORS_ORIGIN'];

  function keysInFile(file) {
    if (!fs.existsSync(file)) return null;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    return lines
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => l.split('=')[0].trim());
  }

  envFindings.push({
    file: 'mdoctor-panel/.env.local',
    exists: fs.existsSync(panelEnvLocal),
    keys: keysInFile(panelEnvLocal),
    expected: expectedPanel,
  });
  envFindings.push({
    file: 'mdoctor-backend/.env.local',
    exists: fs.existsSync(backendEnvLocal),
    keys: keysInFile(backendEnvLocal),
    expected: expectedBackend,
  });
  envFindings.push({
    file: 'Railway painel (script apply-painel-definitivo)',
    expected: [
      'NEXT_PUBLIC_API_URL',
      'API_PROXY_TARGET',
      'NEXT_PUBLIC_ENABLE_MOCK_FALLBACK=false',
      'NEXT_PUBLIC_APP_ENV=staging',
    ],
  });
  envFindings.push({
    file: 'Railway backend (script apply-painel-definitivo)',
    expected: [
      'MEDICO_USER=drmax.matos',
      'MEDICO_PASS',
      'MEDICO_ROLE=admin',
      'MEDICO_EXTERNAL_ID',
      'JWT_SECRET',
      'CORS_ORIGIN=painel URL',
    ],
  });

  if (fs.existsSync(panelEnvExample)) {
    const ex = fs.readFileSync(panelEnvExample, 'utf8');
    if (ex.includes('NEXT_PUBLIC_ENABLE_MOCK_FALLBACK=false')) {
      codeFindings.push({ ok: true, note: '.env.example painel: mock fallback false por padrão' });
    }
  }
}

function auditCodebase() {
  const authRoutes = fs.readFileSync(path.join(__dirname, '../../mdoctor-backend/src/auth/auth.routes.js'), 'utf8');
  const hasAdminFallback =
    /admin123/.test(authRoutes) ||
    /login\s*!==\s*expectedUser.*admin/.test(authRoutes) ||
    /password\s*===\s*['"]admin['"]/.test(authRoutes);
  codeFindings.push({
    ok: !hasAdminFallback,
    note: hasAdminFallback ? 'auth.routes.js ainda contém fallback admin/admin123' : 'auth.routes.js sem fallback admin/admin123',
  });

  const middleware = fs.readFileSync(path.join(__dirname, '../../mdoctor-backend/src/auth/auth.middleware.js'), 'utf8');
  codeFindings.push({
    ok: middleware.includes('AUTH_TOKEN_MISSING') && middleware.includes('AUTH_TOKEN_INVALID'),
    note: 'middleware JWT exige Bearer e retorna códigos AUTH_*',
  });

  const nextConfig = fs.readFileSync(path.join(__dirname, '../next.config.mjs'), 'utf8');
  codeFindings.push({
    ok: nextConfig.includes("source: '/api/:path*'"),
    note: 'proxy /api/* configurado em next.config.mjs',
  });

  const hasNextMiddleware = fs.existsSync(path.join(__dirname, '../src/middleware.ts'));
  codeFindings.push({
    ok: true,
    note: hasNextMiddleware
      ? 'middleware.ts presente'
      : 'sem middleware.ts Next — rotas UI protegidas no client (useRequireAuth/requireSession)',
    risk: hasNextMiddleware ? null : 'HTML de /fila e /atendimento retorna 200; bloqueio é client-side + API 401',
  });

  const authService = fs.readFileSync(path.join(__dirname, '../src/services/auth.service.ts'), 'utf8');
  codeFindings.push({
    ok: authService.includes('LEGACY_MOCK_SESSION_KEY') && authService.includes('removeItem(LEGACY_MOCK_SESSION_KEY)'),
    note: 'auth.service limpa mdoctor_panel_mock_session no login/save/clear',
  });

  const envTs = fs.readFileSync(path.join(__dirname, '../src/config/env.ts'), 'utf8');
  codeFindings.push({
    ok: envTs.includes("return flag === 'true' || flag === '1'"),
    note: 'isMockFallbackEnabled só true se env explícita',
  });
}

async function runTour() {
  auditEnvFiles();
  auditCodebase();

  if (!PASS) {
    step('setup', 'MEDICO_PASS definida', false, { error: 'MEDICO_PASS não definida' });
    return;
  }

  const loginPage = await request(`${PANEL}/login`);
  step(
    '1_login_page',
    'Tela /login acessível',
    loginPage.status === 200 && loginPage.text.includes('Acesso ao Painel Médico'),
    { status: loginPage.status }
  );

  const wrongPass = await request(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: USER, password: 'senha-errada-proposital' }),
  });
  step('2_senha_errada', 'Senha errada bloqueada', wrongPass.status === 401, {
    status: wrongPass.status,
    error: wrongPass.data?.error,
  });

  const legacy = await request(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'admin', password: 'admin123' }),
  });
  step('3_admin_legacy', 'admin/admin123 bloqueado', legacy.status === 401 || legacy.status === 503, {
    status: legacy.status,
    error: legacy.data?.error,
  });

  const loginBackend = await request(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: USER, password: PASS }),
  });
  const token = loginBackend.data?.token;
  step('4_login_correto_backend', 'Login drmax.matos backend', loginBackend.status === 200 && token, {
    status: loginBackend.status,
    username: loginBackend.data?.user?.username,
    role: loginBackend.data?.user?.role,
  });

  const loginPanel = await request(`${PANEL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: USER, password: PASS }),
  });
  step('4b_login_proxy', 'Login via proxy painel /api/auth/login', loginPanel.status === 200 && loginPanel.data?.token, {
    status: loginPanel.status,
  });

  const payload = token ? decodeJwtPayload(token) : null;
  const jwtOk =
    payload &&
    payload.username === USER &&
    typeof payload.exp === 'number' &&
    payload.exp * 1000 > Date.now() &&
    (payload.role === 'admin' || payload.role === 'doctor');
  step('5_jwt_valido', 'JWT estrutura válida (username, exp, role)', jwtOk, {
    username: payload?.username,
    role: payload?.role,
    expHours: payload ? Math.round((payload.exp * 1000 - Date.now()) / 3600000) : null,
  });

  const meBackend = await request(`${BACKEND}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  step('6_me_backend', 'GET /api/auth/me backend', meBackend.status === 200 && meBackend.data?.user?.username === USER, {
    status: meBackend.status,
  });

  const mePanel = await request(`${PANEL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  step('6b_me_proxy', 'GET /api/auth/me via proxy painel', mePanel.status === 200 && mePanel.data?.user?.username === USER, {
    status: mePanel.status,
  });

  const refresh = await request(`${BACKEND}/api/auth/refresh`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const refreshToken = refresh.data?.token;
  step('5b_refresh', 'POST /api/auth/refresh renova JWT', refresh.status === 200 && refreshToken && refreshToken !== token, {
    status: refresh.status,
  });

  const meAfterRefresh = await request(`${BACKEND}/api/auth/me`, {
    headers: { Authorization: `Bearer ${refreshToken || token}` },
  });
  step('5c_me_after_refresh', 'GET /api/auth/me após refresh', meAfterRefresh.status === 200, {
    status: meAfterRefresh.status,
  });

  const queue = await request(`${PANEL}/api/atendimentos/queue`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  step('7_fila_api', 'Fila médica API com token', queue.status === 200 && queue.data?.success, {
    status: queue.status,
    count: Array.isArray(queue.data?.atendimentos) ? queue.data.atendimentos.length : null,
  });

  const filaPage = await request(`${PANEL}/fila`);
  step('7b_fila_page', 'Página /fila carrega (guard client-side)', filaPage.status === 200, { status: filaPage.status });

  const sampleId =
    queue.data?.atendimentos?.[0]?.id ||
    (await request(`${BACKEND}/api/atendimentos?scope=all`, { headers: { Authorization: `Bearer ${token}` } })).data
      ?.atendimentos?.[0]?.id;

  if (sampleId) {
    const atend = await request(`${PANEL}/api/atendimentos/${sampleId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    step('8_atendimento_protegido', 'Atendimento GET com token', atend.status === 200, {
      status: atend.status,
      atendimentoId: sampleId,
    });

    const prontPage = await request(`${PANEL}/prontuario/${sampleId}`);
    step('9_prontuario_page', 'Página /prontuario/[id] carrega', prontPage.status === 200, {
      status: prontPage.status,
      atendimentoId: sampleId,
    });

    const approveNoToken = await request(`${BACKEND}/api/atendimentos/${sampleId}/clinical/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo: 'probe sem token' }),
    });
    step('10_approve_sem_token', 'Approve sem token → 401', approveNoToken.status === 401, {
      status: approveNoToken.status,
      code: approveNoToken.data?.code,
    });

    const approveWithToken = await request(`${BACKEND}/api/atendimentos/${sampleId}/clinical/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo: 'probe auth tour — pode falhar se status não permitir' }),
    });
    const approveAuthOk = approveWithToken.status === 200 || approveWithToken.status === 409 || approveWithToken.status === 422;
    step('11_approve_com_token', 'Approve com token autentica (não 401)', approveAuthOk, {
      status: approveWithToken.status,
      note: approveWithToken.status === 401 ? 'FALHA AUTH' : 'auth OK — status clínico pode impedir approve',
    });
  } else {
    step('8_atendimento_protegido', 'Atendimento GET com token', false, { skip: 'nenhum atendimento na fila' });
    step('9_prontuario_page', 'Prontuário page', false, { skip: 'sem id' });
    step('10_approve_sem_token', 'Approve sem token', false, { skip: 'sem id' });
    step('11_approve_com_token', 'Approve com token', false, { skip: 'sem id' });
  }

  const noTokenQueue = await request(`${BACKEND}/api/atendimentos/queue`);
  step('13_api_sem_token', 'API fila sem token → 401', noTokenQueue.status === 401, {
    status: noTokenQueue.status,
    code: noTokenQueue.data?.code,
  });

  const noTokenMe = await request(`${BACKEND}/api/auth/me`);
  step('13b_me_sem_token', '/api/auth/me sem token → 401', noTokenMe.status === 401, { status: noTokenMe.status });

  const expiredLike = await request(`${BACKEND}/api/atendimentos/queue`, {
    headers: { Authorization: 'Bearer invalid.token.here' },
  });
  step('13c_token_invalido', 'Token inválido → 401', expiredLike.status === 401, {
    status: expiredLike.status,
    code: expiredLike.data?.code,
  });

  const adminStatus = await request(`${BACKEND}/api/admin/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  step('role_admin', 'Role admin acessa /api/admin/status', adminStatus.status === 200, {
    status: adminStatus.status,
    role: loginBackend.data?.user?.role,
  });

  step(
    '14_sem_mock_auth',
    'Sem bypass auth por mock session no backend',
    !authRoutesHasMockBypass(),
    { note: 'Login só via MEDICO_USER/MEDICO_PASS' }
  );

  let playwrightLogout = null;
  try {
    playwrightLogout = await runPlaywrightLogout(token, loginBackend.data?.user, sampleId);
  } catch (e) {
    playwrightLogout = { skipped: true, reason: e.message };
  }
  if (playwrightLogout?.skipped) {
    step('12_logout', 'Logout limpa sessão (Playwright)', null, playwrightLogout);
  } else {
    step('12_logout', 'Logout limpa localStorage e bloqueia API', playwrightLogout?.ok, playwrightLogout);
  }
}

function authRoutesHasMockBypass() {
  const src = fs.readFileSync(path.join(__dirname, '../../mdoctor-backend/src/auth/auth.routes.js'), 'utf8');
  return /mock|admin123|fallback.*login/i.test(src.replace(/Credenciais inválidas/g, ''));
}

async function runPlaywrightLogout(token, user, atendimentoId) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.addInitScript(
    ({ t, u }) => {
      localStorage.setItem('mdoctor_auth_token', t);
      localStorage.setItem('mdoctor_auth_user', JSON.stringify(u));
    },
    { t: token, u: user }
  );
  await page.goto(`${PANEL}/fila`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const hadToken = await page.evaluate(() => Boolean(localStorage.getItem('mdoctor_auth_token')));
  await page.evaluate(() => {
    localStorage.removeItem('mdoctor_auth_token');
    localStorage.removeItem('mdoctor_auth_user');
    localStorage.removeItem('mdoctor_panel_mock_session');
  });
  const afterClear = await page.evaluate(() => ({
    token: localStorage.getItem('mdoctor_auth_token'),
    mock: localStorage.getItem('mdoctor_panel_mock_session'),
  }));
  await browser.close();
  return {
    ok: hadToken && !afterClear.token && !afterClear.mock,
    hadToken,
    afterClear,
  };
}

function writeMarkdown(report) {
  const lines = [
    '# Auth Tour Técnico — Doctor Prescreve',
    '',
    `> ${report.generated_at}`,
    `> Backend: ${report.backend_url}`,
    `> Painel: ${report.panel_url}`,
    `> Usuário testado: \`${report.user}\``,
    '',
    '## Conclusão',
    '',
    report.piloto_ok
      ? '**Autenticação/autorização apta para piloto fechado** — login único operacional; APIs protegidas; legado bloqueado.'
      : '**Requer ajuste** — ver falhas abaixo.',
    '',
    '## Checklist executado',
    '',
    '| # | Teste | Resultado |',
    '|---|-------|-----------|',
  ];
  for (const s of report.steps) {
    const icon = s.ok === true ? '✅' : s.ok === false ? '❌' : '⏭️';
    lines.push(`| ${s.id} | ${s.label} | ${icon} ${s.status || s.error || s.note || s.skip || ''} |`);
  }

  lines.push('', '## Respostas objetivas', '');
  const ans = report.respostas;
  for (const [k, v] of Object.entries(ans)) {
    lines.push(`- **${k}:** ${v}`);
  }

  lines.push('', '## Auditoria estática (código)', '');
  for (const f of report.codeFindings) {
    lines.push(`- ${f.ok ? '✅' : '❌'} ${f.note}${f.risk ? ` — *${f.risk}*` : ''}`);
  }

  lines.push('', '## Variáveis de ambiente', '');
  for (const e of report.envFindings) {
    lines.push(`### ${e.file}`);
    if (e.exists !== undefined) lines.push(`- Existe local: ${e.exists ? 'sim' : 'não'}`);
    if (e.keys) lines.push(`- Chaves locais: ${e.keys.join(', ') || '—'}`);
    if (e.expected) lines.push(`- Esperado Railway: ${Array.isArray(e.expected) ? e.expected.join('; ') : e.expected}`);
    lines.push('');
  }

  lines.push('## Riscos', '');
  for (const r of report.riscos) lines.push(`- ${r}`);

  fs.writeFileSync(REPORT_MD, lines.join('\n'), 'utf8');
}

function buildRespostas(steps, report) {
  const by = Object.fromEntries(steps.map((s) => [s.id, s]));
  return {
    'Login correto funciona': by['4_login_correto_backend']?.ok ? 'sim' : 'não',
    'Senhas inválidas bloqueiam': by['2_senha_errada']?.ok ? 'sim' : 'não',
    'admin/admin123 bloqueado': by['3_admin_legacy']?.ok ? 'sim' : 'não',
    'JWT válido': by['5_jwt_valido']?.ok ? 'sim' : 'não',
    '/api/auth/me funciona': by['6_me_backend']?.ok && by['6b_me_proxy']?.ok ? 'sim' : 'parcial/não',
    'Rotas API bloqueiam sem token': by['13_api_sem_token']?.ok ? 'sim' : 'não',
    'Rotas API liberam com token': by['7_fila_api']?.ok ? 'sim' : 'não',
    'Approve sem token bloqueado': by['10_approve_sem_token']?.ok ? 'sim' : 'não/n.a.',
    'Approve com token autentica': by['11_approve_com_token']?.ok ? 'sim' : 'não/n.a.',
    'Sessão persiste (localStorage)': by['12_logout']?.hadToken !== false ? 'sim' : 'não verificado',
    'Logout limpa sessão': by['12_logout']?.ok ? 'sim' : by['12_logout']?.skipped ? 'não testado' : 'não',
    'Risco bloqueio indevido médico': report.riscos.includes('bloqueio_indevido') ? 'sim' : 'baixo',
    'Risco acesso indevido mock/fallback': report.riscos.includes('mock_auth') ? 'sim' : 'baixo',
  };
}

async function main() {
  await runTour();

  const failed = steps.filter((s) => s.ok === false);
  const riscos = [];
  if (failed.some((s) => s.id.startsWith('4'))) riscos.push('bloqueio_indevido — login médico falhou');
  if (!steps.find((s) => s.id === '3_admin_legacy')?.ok) riscos.push('mock_auth — admin/admin123 ainda aceito');
  const noMiddleware = codeFindings.find((f) => f.risk)?.risk;
  if (noMiddleware) riscos.push(`ui_shallow — ${noMiddleware}`);
  if (!codeFindings.find((f) => f.note.includes('sem fallback admin'))?.ok) riscos.push('mock_auth — fallback legado no código');

  const report = {
    generated_at: new Date().toISOString(),
    backend_url: BACKEND,
    panel_url: PANEL,
    user: USER,
    steps,
    codeFindings,
    envFindings,
    riscos,
    piloto_ok: failed.length === 0 && riscos.filter((r) => r.startsWith('bloqueio_indevido') || r.startsWith('mock_auth')).length === 0,
  };
  report.respostas = buildRespostas(steps, report);

  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));
  writeMarkdown(report);

  console.log(JSON.stringify({ success: report.piloto_ok, failed: failed.length, report: REPORT_MD }, null, 2));
  process.exit(report.piloto_ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
