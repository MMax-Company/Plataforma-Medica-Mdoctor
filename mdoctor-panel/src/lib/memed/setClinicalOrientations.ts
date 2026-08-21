import { PRESCRIPTION_MODULE } from './onLoadPrescription';
import type { AtendimentoForMemed } from './buildPatientFromAtendimento';

// Rodapé institucional fixo — não inclui CPF, telefone, e-mail, endereço completo
// nem diagnóstico/informação clínica detalhada (apenas identificação básica do
// atendimento e do paciente, já exibida ao médico em outras telas do painel).
const INSTITUTIONAL_FOOTER =
  'Consulta médica realizada pelo Doctor Prescreve.\n' +
  'Documento emitido após avaliação médica individual.';

/**
 * Orientações clínicas + dados complementares do atendimento no módulo, antes de
 * abrir a prescrição — uma única chamada a setAdditionalData (o comando substitui
 * o objeto anterior, então orientação clínica e header/footer institucional
 * precisam ir juntos aqui).
 */
export async function setClinicalOrientations(atendimento: AtendimentoForMemed): Promise<void> {
  if (!window.MdHub?.command?.send) return;

  const clinical = (atendimento.dados_clinicos || {}) as Record<string, unknown>;
  const text = String(clinical.conduta || clinical.orientacoes || clinical.orientacao || '').trim();

  // Só os 8 primeiros caracteres do UUID no papel timbrado — o ID completo
  // continua em atendimento.id (banco/vínculos) e é o que passa em setPaciente.
  const shortId = String(atendimento.id || '').slice(0, 8);

  const payload: Record<string, unknown> = {
    header: [{ Atendimento: shortId }],
    footer: INSTITUTIONAL_FOOTER,
  };
  if (text) {
    payload.orientacao = text;
    payload.orientacoes = text;
  }

  try {
    await window.MdHub.command.send(PRESCRIPTION_MODULE, 'setAdditionalData', payload);
  } catch {
    // comando opcional por versão do widget
  }
}
