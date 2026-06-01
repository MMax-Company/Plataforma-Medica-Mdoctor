const fs = require('fs');
const path = require('path');

function loadDotenv(filePath, { override = false } = {}) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val === '') continue;
    // Não sobrescrever variáveis já definidas no shell (ex.: credenciais staging E2E).
    if (process.env[key] !== undefined) continue;
    if (override || !process.env[key]) process.env[key] = val;
  }
}

loadDotenv(path.join(__dirname, '../.env'), { override: true });
loadDotenv(path.join(__dirname, '../.env.local'), { override: true });
module.exports = { loadDotenv };
