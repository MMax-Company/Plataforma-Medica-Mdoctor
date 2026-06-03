/** Extrai IDs/URLs do payload prescricaoImpressa (formatos variados do widget). */
export function parsePrescriptionPayload(payload: unknown) {
  const data = payload as Record<string, unknown> | null | undefined;
  const nested = (data?.prescription || data?.prescricao || data) as Record<string, unknown> | undefined;
  const attrs = (nested?.attributes || data?.attributes) as Record<string, unknown> | undefined;

  const receitaId =
    nested?.id || data?.id || attrs?.id || data?.prescription_id || data?.prescriptionId || null;

  const pdfUrl =
    nested?.pdf ||
    nested?.pdf_url ||
    data?.pdf ||
    data?.pdf_url ||
    attrs?.pdf_url ||
    attrs?.url_document ||
    null;

  const digitalLink =
    nested?.digital_link ||
    nested?.link ||
    data?.digital_link ||
    data?.link ||
    data?.digitalLink ||
    attrs?.digital_link ||
    attrs?.link ||
    null;

  const unlockCode =
    nested?.unlock_code ||
    nested?.codigo_desbloqueio ||
    data?.unlock_code ||
    data?.unlockCode ||
    data?.codigo_desbloqueio ||
    attrs?.unlock_code ||
    attrs?.codigo_desbloqueio ||
    null;

  return {
    receitaId: receitaId ? String(receitaId) : null,
    receitaUrl: (nested?.url || data?.url || digitalLink) as string | null,
    pdfUrl: pdfUrl ? String(pdfUrl) : null,
    digitalLink: digitalLink ? String(digitalLink) : null,
    unlockCode: unlockCode ? String(unlockCode) : null,
    raw: payload,
  };
}
