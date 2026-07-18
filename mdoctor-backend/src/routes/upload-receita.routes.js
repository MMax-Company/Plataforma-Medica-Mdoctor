const express = require('express');
const multer = require('multer');
const { createAuditLog } = require('../store/audit.store');
const { getAtendimento } = require('../store/atendimentos.store');
const { hasStoredPreviousPrescription } = require('../services/clinical-payload-normalizer.service');
const { MAX_BYTES, formatIngestError } = require('../services/previous-prescription-storage.service');
const { completeExternalPrescriptionUpload } = require('../services/prescription-upload.service');
const { resumeTypebotAfterPrescriptionUpload } = require('../services/typebot-prescription-upload.service');
const {
  assertTokenActive,
  resolveTokenRecord
} = require('../services/prescription-upload-token.service');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 }
});

function renderUploadPage({ token, patientName, expiresAt, errorMessage = null, success = false }) {
  const safeName = String(patientName || 'Paciente').replace(/</g, '&lt;');
  const expiry = expiresAt ? new Date(expiresAt).toLocaleString('pt-BR') : '';
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Doctor Prescreve — Enviar receita anterior</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Segoe UI", system-ui, sans-serif; background: #f4f7fc; color: #080d33; }
    .wrap { max-width: 520px; margin: 0 auto; padding: 24px 16px 48px; }
    .card { background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 8px 24px rgba(8,13,51,.08); border: 1px solid #e5eaf2; }
    h1 { font-size: 1.35rem; margin: 0 0 8px; }
    p { line-height: 1.5; color: #26325f; font-size: 0.95rem; }
    .badge { display: inline-block; background: #eef4ff; color: #1557ff; font-weight: 700; font-size: 0.75rem; padding: 4px 10px; border-radius: 999px; margin-bottom: 12px; }
    label { display: block; font-weight: 700; margin: 16px 0 8px; font-size: 0.9rem; }
    input[type=file] { width: 100%; padding: 12px; border: 1px dashed #b8c4d9; border-radius: 8px; background: #fafbfd; }
    button { width: 100%; margin-top: 20px; padding: 14px; border: 0; border-radius: 8px; background: #1557ff; color: #fff; font-weight: 800; font-size: 1rem; cursor: pointer; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .msg { margin-top: 16px; padding: 12px; border-radius: 8px; font-size: 0.9rem; }
    .err { background: #fff1f1; color: #a40000; border: 1px solid #ffc9c9; }
    .ok { background: #ecfdf3; color: #0b6b3a; border: 1px solid #b7ebd0; }
    .hint { font-size: 0.8rem; color: #5b6475; margin-top: 8px; }
    .tips { margin-top: 16px; padding: 12px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; font-size: 0.82rem; color: #78350f; }
    .tips ul { margin: 6px 0 0 16px; padding: 0; }
    .tips li { margin-bottom: 4px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <span class="badge">Doctor Prescreve</span>
      <h1>Enviar foto da receita anterior</h1>
      <p>Olá, <strong>${safeName}</strong>. Para concluir sua solicitação, envie a foto ou PDF da sua receita anterior. O atendimento só seguirá para análise médica após o envio.</p>
      ${expiry ? `<p class="hint">Este link é válido até ${expiry}.</p>` : ''}
      ${
        success
          ? `<div class="msg ok">✅ Receita enviada com sucesso! Seu atendimento entrou na fila médica. Volte ao WhatsApp para acompanhar.</div>`
          : errorMessage
            ? `<div class="msg err">⚠️ ${String(errorMessage).replaceAll('<', '&lt;')}</div>
               <div class="tips"><strong>Dicas para uma boa foto:</strong><ul>
                 <li>Fotografe em local bem iluminado (luz natural é ideal)</li>
                 <li>Mantenha a câmera firme, sem tremor</li>
                 <li>A receita deve aparecer completa na foto, incluindo a data</li>
                 <li>Evite reflexos ou sombras sobre o papel</li>
               </ul></div>`
            : ''
      }
      ${
        success
          ? ''
          : `<form method="post" action="/api/upload-receita/${encodeURIComponent(token)}" enctype="multipart/form-data">
        <label for="file">Arquivo (JPG, PNG ou PDF — máx. 10 MB)</label>
        <input id="file" name="file" type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" required />
        <button type="submit" id="btn">${errorMessage ? 'Tentar novamente' : 'Enviar foto da receita'}</button>
      </form>
      <p class="hint">Seu arquivo é armazenado de forma segura e usado apenas para análise da renovação.</p>`
      }
    </div>
  </div>
</body>
</html>`;
}

async function loadSessionContext(token) {
  const record = await resolveTokenRecord(token);
  assertTokenActive(record);
  const atendimento = await getAtendimento(record.atendimentoId);
  if (!atendimento) {
    const err = new Error('Atendimento não encontrado para este link');
    err.statusCode = 404;
    throw err;
  }
  return { record, atendimento };
}

router.get('/:token/status', async (req, res) => {
  try {
    // Não exige token ativo: token usado significa upload concluído, e esta
    // rota precisa reportar isso (o Typebot consulta após o envio).
    const record = await resolveTokenRecord(req.params.token);
    if (!record) {
      const err = new Error('Link de upload inválido ou expirado');
      err.code = 'UPLOAD_TOKEN_INVALID';
      err.statusCode = 404;
      throw err;
    }
    const atendimento = await getAtendimento(record.atendimentoId);
    if (!atendimento) {
      const err = new Error('Atendimento não encontrado para este link');
      err.statusCode = 404;
      throw err;
    }
    const clinical = atendimento.dados_clinicos || {};
    const uploaded = hasStoredPreviousPrescription(clinical);
    const uploadStatus = uploaded ? 'completed' : (clinical.prescription_upload_session?.status || 'pending');
    return res.json({
      success: true,
      token_status: record.status,
      atendimento_id: atendimento.id,
      atendimento_status: atendimento.status,
      upload_completed: uploaded ? 'true' : 'false',
      upload_status: uploadStatus,
      foto_receita_url: clinical.foto_receita_url || clinical.previous_prescription_url || null,
      upload_url: clinical.prescription_upload_session?.upload_url || null,
      expires_at: clinical.prescription_upload_session?.expires_at || new Date(record.expiresAt).toISOString(),
      message: uploaded
        ? 'Receita anterior vinculada ao atendimento'
        : 'Aguardando envio da receita anterior nesta conversa do WhatsApp'
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      error: error.message,
      code: error.code || 'UPLOAD_STATUS_ERROR'
    });
  }
});

router.post('/:token', upload.single('file'), async (req, res) => {
  const token = req.params.token;
  const correlationId = req.get('X-Correlation-Id') || req.requestId || 'unknown';

  try {
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ success: false, error: 'Arquivo obrigatório (campo file)', correlationId });
    }

    const result = await completeExternalPrescriptionUpload({
      token,
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      filename: req.file.originalname,
      correlationId
    });

    const whatsappResume = await resumeTypebotAfterPrescriptionUpload({
      atendimentoId: result.atendimento?.id,
      token,
      correlationId,
      phone: result.atendimento?.paciente_telefone
    }).catch(() => ({ ok: false, code: 'RESUME_ERROR' }));

    const wantsHtml = String(req.headers.accept || '').includes('text/html');
    if (wantsHtml) {
      const html = renderUploadPage({
        token,
        patientName: result.atendimento?.paciente_nome,
        expiresAt: null,
        success: true
      });
      return res.status(200).type('html').send(html);
    }

    return res.json({
      success: true,
      correlationId,
      message: 'Receita anterior recebida com sucesso',
      atendimento_id: result.atendimento?.id,
      status: result.atendimento?.status,
      whatsapp_resume: whatsappResume,
      prescription: {
        storage_path: result.prescriptionMeta?.previous_prescription_storage_path,
        mime_type: result.prescriptionMeta?.previous_prescription_mime_type,
        uploaded_at: result.prescriptionMeta?.previous_prescription_uploaded_at
      }
    });
  } catch (error) {
    const formatted = formatIngestError(error);
    await createAuditLog({
      entity_type: 'prescription_upload',
      action: 'upload_rejected',
      actor: 'patient',
      payload: { correlationId, token: '[redacted]', ...formatted }
    });

    const wantsHtml = String(req.headers.accept || '').includes('text/html');
    if (wantsHtml) {
      const html = renderUploadPage({
        token,
        patientName: 'Paciente',
        errorMessage: formatted.message
      });
      return res.status(error.statusCode || 422).type('html').send(html);
    }

    return res.status(error.statusCode || 422).json({ success: false, correlationId, ...formatted });
  }
});

function registerUploadPageRoutes(app) {
  const pageHandler = async (req, res) => {
    try {
      const { record, atendimento } = await loadSessionContext(req.params.token);
      const clinical = atendimento.dados_clinicos || {};
      if (hasStoredPreviousPrescription(clinical)) {
        return res
          .status(200)
          .type('html')
          .send(
            renderUploadPage({
              token: req.params.token,
              patientName: atendimento.paciente_nome,
              success: true
            })
          );
      }
      return res
        .status(200)
        .type('html')
        .send(
          renderUploadPage({
            token: req.params.token,
            patientName: atendimento.paciente_nome,
            expiresAt: clinical.prescription_upload_session?.expires_at || new Date(record.expiresAt).toISOString()
          })
        );
    } catch (error) {
      return res
        .status(error.statusCode || 404)
        .type('html')
        .send(
          renderUploadPage({
            token: req.params.token,
            patientName: 'Paciente',
            errorMessage: error.message
          })
        );
    }
  };

  app.get('/upload-receita/:token', pageHandler);
  app.get('/receita/upload/:token', pageHandler);
}

module.exports = { router, registerUploadPageRoutes, renderUploadPage };
