require('dotenv').config();

const Redis = require('redis');
const { forwardWhatsAppWebhook } = require('../services/backend-client');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const QUEUE_NAME = process.env.WHATSAPP_QUEUE_NAME || 'whatsapp_queue';
const INTERVAL_MS = Number(process.env.AUTOMATION_WORKER_INTERVAL_MS || 1000);
const DEAD_QUEUE = `${QUEUE_NAME}:dead`;
const MAX_ATTEMPTS = Number(process.env.AUTOMATION_WORKER_MAX_ATTEMPTS || 3);

let running = true;
const client = Redis.createClient({ url: REDIS_URL });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJob(raw) {
  const data = JSON.parse(raw);
  return {
    attempts: Number(data.attempts || 0),
    payload: data.payload || data
  };
}

async function requeue(raw, attempts, errorMessage) {
  const target = attempts >= MAX_ATTEMPTS ? DEAD_QUEUE : QUEUE_NAME;
  const parsed = (() => {
    try {
      return parseJob(raw);
    } catch (_err) {
      return { payload: raw };
    }
  })();

  await client.lPush(
    target,
    JSON.stringify({
      attempts,
      error: errorMessage,
      failedAt: new Date().toISOString(),
      payload: parsed.payload
    })
  );
}

async function processQueue() {
  await client.connect();
  console.log(`[mdoctor-automation-worker] fila ${QUEUE_NAME} conectada`);

  while (running) {
    const raw = await client.rPop(QUEUE_NAME);
    if (!raw) {
      await sleep(INTERVAL_MS);
      continue;
    }

    try {
      const job = parseJob(raw);
      await forwardWhatsAppWebhook(job.payload, `worker-${Date.now()}`);
      console.log('[mdoctor-automation-worker] mensagem encaminhada');
    } catch (error) {
      console.error('[mdoctor-automation-worker] falha:', error.message);
      const attempts = (() => {
        try {
          return parseJob(raw).attempts + 1;
        } catch (_err) {
          return MAX_ATTEMPTS;
        }
      })();
      await requeue(raw, attempts, error.message);
    }
  }

  await client.quit();
}

process.on('SIGINT', () => {
  running = false;
});

process.on('SIGTERM', () => {
  running = false;
});

processQueue().catch((error) => {
  console.error('[mdoctor-automation-worker] erro fatal:', error);
  process.exit(1);
});
