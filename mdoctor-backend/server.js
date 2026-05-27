const fs = require('fs');
const path = require('path');

const localEnvPath = path.join(__dirname, '.env.local');
const shouldLoadLocalEnv = (
  process.env.NODE_ENV !== 'production' &&
  !process.env.RAILWAY_ENVIRONMENT &&
  !process.env.RAILWAY_PROJECT_ID &&
  fs.existsSync(localEnvPath)
);
const loadedEnvFile = shouldLoadLocalEnv ? '.env.local' : '.env';

require('dotenv').config({
  path: path.join(__dirname, loadedEnvFile),
  override: shouldLoadLocalEnv
});
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { initSupabase } = require('./src/config/supabase');
const { getReadinessReport } = require('./src/config/readiness');
const logger = require('./src/config/logger');
const requestLogger = require('./src/middlewares/request-logger');
const { cleanupRateLimitBuckets, makeRateLimit } = require('./src/middlewares/rate-limit');

function isLocalRuntime() {
  const environmentName = process.env.ENVIRONMENT_NAME || '';
  return process.env.NODE_ENV !== 'production' && environmentName !== 'staging';
}

function applyLocalSafetyDefaults() {
  if (!isLocalRuntime()) return;
  process.env.WHATSAPP_ENABLED = 'false';
  process.env.DELIVERY_MOCK_ENABLED = 'true';
}

function logEnvironmentBanner() {
  logger.info('environment_startup_banner', {
    nodeEnv: process.env.NODE_ENV || 'development',
    environmentName: process.env.ENVIRONMENT_NAME || (isLocalRuntime() ? 'local' : 'unset'),
    envFile: loadedEnvFile,
    dataEnv: process.env.DATA_ENV || 'unset',
    port: process.env.PORT || 3004,
    baseUrl: process.env.BASE_URL || null,
    corsOrigin: process.env.CORS_ORIGIN || null,
    supabaseConfigured: Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY)),
    memedEnvironment: process.env.MEMED_ENVIRONMENT || process.env.MEMED_ENV || 'development',
    memedConfigured: Boolean(process.env.MEMED_API_KEY && process.env.MEMED_SECRET_KEY),
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
    whatsappEnabled: process.env.WHATSAPP_ENABLED === 'true',
    deliveryMockEnabled: process.env.DELIVERY_MOCK_ENABLED === 'true',
    legacyCompatEnabled: process.env.LEGACY_COMPAT_ENABLED === 'true'
  });
}

applyLocalSafetyDefaults();
logEnvironmentBanner();

const app = express();
const PORT = process.env.PORT || 3004;
initSupabase();
const startupReadiness = getReadinessReport();
if (startupReadiness.status !== 'ok') {
  logger.warn('production_readiness_incomplete', {
    status: startupReadiness.status,
    failures: startupReadiness.failures.map((item) => item.name),
    warnings: startupReadiness.warnings.map((item) => item.name)
  });
}

const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000,http://localhost:3001')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.set('trust proxy', 1);
app.use(helmet());
app.use(requestLogger);
app.use(cors({
  origin(origin, callback) {
    if (!origin || corsOrigins.includes('*') || corsOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origem nao autorizada pelo CORS'));
  },
  credentials: true
}));
app.use(makeRateLimit({
  name: 'global',
  skip: (req) => req.path === '/health' || req.path === '/healthz' || req.path === '/readyz'
}));
app.use('/api/auth', makeRateLimit({
  name: 'auth',
  max: Number(process.env.AUTH_RATE_LIMIT_MAX || 30)
}));
app.use('/api/whatsapp/webhook', makeRateLimit({
  name: 'whatsapp_webhook',
  max: Number(process.env.WEBHOOK_RATE_LIMIT_MAX || 120)
}));
app.use(express.json({limit:'1mb',strict:false}));
app.use(express.urlencoded({extended:true}));
app.use(require('./src/legacy-compat').legacyCompatRoutes);

const healthHandler = (req,res)=>res.json({status:'OK',service:'Backend-MDoctor',port:PORT,timestamp:new Date().toISOString()});
app.get('/health', healthHandler);
app.get('/healthz', healthHandler);
app.get('/readyz', (_req, res) => {
  const report = getReadinessReport();
  res.status(report.status === 'fail' ? 503 : 200).json(report);
});

// Mount modular routes (Spec §3)
app.use('/api/eligibility',require('./src/routes/eligibility.routes'));
app.use('/api/atendimentos',require('./src/routes/atendimentos.routes'));
app.use('/api/patients',require('./src/routes/patients.routes'));
app.use('/api/prescriptions',require('./src/routes/prescriptions.routes'));
app.use('/api/whatsapp',require('./src/routes/whatsapp.routes'));
app.use('/api/memed',require('./src/routes/memed.routes'));
app.use('/api/auth',require('./src/auth/auth.routes'));
app.use('/api/admin',require('./src/routes/admin.routes'));

app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Rota nao encontrada' });
});

app.use((err, req, res, _next) => {
  logger.error('unhandled_error', {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl || req.url,
    error: err
  });
  res.status(err.status || 500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Erro interno do servidor' : err.message,
    requestId: req.requestId
  });
});

setInterval(cleanupRateLimitBuckets, 60 * 1000).unref();

app.listen(PORT,()=>{
  logger.info('server_started', {
    port: PORT,
    health: `http://localhost:${PORT}/health`,
    nodeEnv: process.env.NODE_ENV || 'development'
  });
});

// Init WhatsApp service (Spec §9)
if (process.env.WHATSAPP_ENABLED === 'true') {
  const whatsapp = require('./src/whatsapp/whatsapp.service');
  whatsapp.connect().catch(console.error);
} else {
  logger.info('whatsapp_disabled', { enabled: false });
}
