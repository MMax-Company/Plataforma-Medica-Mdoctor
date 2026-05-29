function ok(message) {
  console.log(`[OK] ${message}`);
}

function info(message) {
  console.log(`[INFO] ${message}`);
}

function warn(message) {
  console.warn(`[AVISO] ${message}`);
}

function fail(message) {
  console.error(`[ERRO] ${message}`);
}

module.exports = { ok, info, warn, fail };
