#!/usr/bin/env node
const PANEL = 'https://painel-medico-staging-staging.up.railway.app';

async function main() {
  const html = await fetch(`${PANEL}/login`).then((r) => r.text());
  console.log('PAINEL NOVO V2:', html.includes('PAINEL NOVO V2'));

  const chunkMatch = html.match(/\/_next\/static\/chunks\/app\/fila\/page-[a-f0-9]+\.js/);
  if (!chunkMatch) {
    console.log('fila chunk: not linked from login (load /fila separately)');
    const filaHtml = await fetch(`${PANEL}/fila`).then((r) => r.text());
    const m2 = filaHtml.match(/\/_next\/static\/chunks\/app\/fila\/page-[a-f0-9]+\.js/);
    if (!m2) {
      console.log('fila chunk: not found in /fila HTML either');
      process.exit(1);
    }
    await checkChunk(m2[0]);
    return;
  }
  await checkChunk(chunkMatch[0]);
}

async function checkChunk(path) {
  const js = await fetch(`${PANEL}${path}`).then((r) => r.text());
  const hasOpen = js.includes('openAtendimento');
  const hasAuto = js.includes('autoEvaluate');
  console.log('chunk:', path);
  console.log('openAtendimento:', hasOpen);
  console.log('autoEvaluate:', hasAuto);
  console.log('fix_deployed:', hasOpen && !hasAuto);
  process.exit(hasOpen && !hasAuto ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
