#!/usr/bin/env node
import fs from 'node:fs';
import { chromium } from 'playwright';

const AT = process.argv[2] || '63387135-460b-4b7d-bc42-4ced4efd7a2f';
const PANEL = 'https://painel-medico-staging-staging.up.railway.app';
const BACKEND = 'https://mdoctor-backend-staging-staging.up.railway.app';

const envPath = 'mdoctor-panel/.env.local';
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const login = await fetch(`${BACKEND}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    user: process.env.TOUR_LOGIN_USER || 'drmax.matos',
    password: process.env.MEDICO_PASS || process.env.TOUR_LOGIN_PASS,
  }),
}).then((r) => r.json());

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.addInitScript(({ jwt, user }) => {
  localStorage.setItem('mdoctor_auth_token', jwt);
  localStorage.setItem('mdoctor_auth_user', JSON.stringify(user));
}, { jwt: login.token, user: login.user });

await page.goto(`${PANEL}/receita?atendimentoId=${AT}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => Boolean(window.MdHub?.command?.send && window.MdSinapsePrescricao), undefined, {
  timeout: 180000,
});
await page.waitForTimeout(5000);

const results = await page.evaluate(async (atendimentoId) => {
  const probe = async (label, payload) => {
    const s = performance.now();
    try {
      const resp = await Promise.race([
        window.MdHub.command.send('plataforma.prescricao', 'setPaciente', payload),
        new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), 20000)),
      ]);
      return { label, outcome: 'OK', ms: Math.round(performance.now() - s), payload };
    } catch (e) {
      return {
        label,
        outcome: e.message === 'TIMEOUT' ? 'TIMEOUT' : 'REJECT',
        ms: Math.round(performance.now() - s),
        payload,
      };
    }
  };

  const minimal = { nome: 'MEMED CLEAN TEST', telefone: '11951386869', idExterno: atendimentoId };
  const full = {
    ...minimal,
    cpf: '52998224725',
    email: 'memed.clean@homolog.local',
    data_nascimento: '15/08/1988',
  };

  const out = [];
  out.push(await probe('minimal_first', minimal));
  out.push(await probe('full_second', full));
  out.push(await probe('minimal_third', minimal));

  if (out[0].outcome !== 'OK' && out[1].outcome === 'OK') {
    try {
      await window.MdHub.command.send('plataforma.prescricao', 'newPrescription');
      out.push({
        label: 'newPrescription_after_full',
        outcome: 'OK',
        payload: null,
      });
      out.push(
        await probe('addItem', {
          nome: 'Losartana 50mg',
          posologia: 'Tomar 1 comprimido por via oral a cada 24 horas. Uso contínuo.',
          quantidade: 30,
        }).then((r) => ({ ...r, label: 'addItem_after_full' })),
      );
      window.MdHub.module.show('plataforma.prescricao');
      out.push({ label: 'show', outcome: 'OK' });
    } catch (e) {
      out.push({ label: 'chain_after_full', outcome: 'REJECT', error: String(e.message || e) });
    }
  }

  return out;
}, AT);

  console.log(JSON.stringify(results, null, 2));
  await page.screenshot({ path: 'docs/MEMED-HOMOLOGACAO-PREFILL-STAGING-WIDGET.png', fullPage: false });
  await browser.close();
