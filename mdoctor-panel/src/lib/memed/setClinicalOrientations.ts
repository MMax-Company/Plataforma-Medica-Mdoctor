import { PRESCRIPTION_MODULE } from './onLoadPrescription';
import { buildPatientFromAtendimento, type AtendimentoForMemed } from './buildPatientFromAtendimento';

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
  const patient = buildPatientFromAtendimento(atendimento);

  const payload: Record<string, unknown> = {
    header: [
      { Atendimento: atendimento.id },
      { Paciente: patient.nome, 'Data de nascimento': patient.data_nascimento || '' },
    ],
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
