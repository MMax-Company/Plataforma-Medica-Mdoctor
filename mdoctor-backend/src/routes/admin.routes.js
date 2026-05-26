const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { getReadinessReport } = require('../config/readiness');
const { listAtendimentos, listRecentDecisoesLog, statusInGroup } = require('../store/atendimentos.store');

const router = express.Router();

function countByStatus(atendimentos) {
  return atendimentos.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
}

router.get('/status', requireAuth, requireRole('admin'), async (req, res) => {
  const atendimentos = await listAtendimentos();
  const audit = await listRecentDecisoesLog(25);
  const readiness = getReadinessReport();
  const pendingDelivery = atendimentos.filter((item) => statusInGroup(item.status, 'readyToDeliver'));
  const inMedicalFlow = atendimentos.filter((item) => statusInGroup(item.status, 'inMedicalFlow'));

  res.json({
    success: true,
    user: {
      id: req.user?.sub,
      name: req.user?.name || req.user?.username,
      role: req.user?.role
    },
    readiness,
    metrics: {
      total: atendimentos.length,
      queue: atendimentos.filter((item) => statusInGroup(item.status, 'queue')).length,
      inMedicalFlow: inMedicalFlow.length,
      readyToDeliver: pendingDelivery.length,
      delivered: atendimentos.filter((item) => statusInGroup(item.status, 'delivered')).length,
      rejected: atendimentos.filter((item) => statusInGroup(item.status, 'rejected')).length,
      byStatus: countByStatus(atendimentos)
    },
    audit,
    integrations: {
      memed: {
        configured: Boolean(process.env.MEMED_API_KEY && process.env.MEMED_SECRET_KEY),
        environment: process.env.MEMED_ENVIRONMENT || process.env.MEMED_ENV || 'development'
      },
      supabase: {
        configured: Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY))
      },
      delivery: {
        twilioWhatsapp: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && (process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_FROM_WHATSAPP)),
        twilioSms: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && (process.env.TWILIO_SMS_FROM || process.env.TWILIO_PHONE_NUMBER)),
        resendEmail: Boolean(process.env.RESEND_API_KEY && (process.env.RESEND_FROM_EMAIL || process.env.EMAIL_FROM))
      }
    }
  });
});

module.exports = router;
