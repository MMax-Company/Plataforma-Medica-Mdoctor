require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { initSupabase } = require('./src/config/supabase');
const { getReadinessReport } = require('./src/config/readiness');
const logger = require('./src/config/logger');
const requestLogger = require('./src/middlewares/request-logger');
const { cleanupRateLimitBuckets, makeRateLimit } = require('./src/middlewares/rate-limit');

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
