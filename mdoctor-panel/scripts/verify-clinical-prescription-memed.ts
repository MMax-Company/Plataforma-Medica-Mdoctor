/**
 * Verifica clinicalPrescriptionToMemedItems com atendimento c302bd9e (staging).
 * Uso: npx tsx scripts/verify-clinical-prescription-memed.ts
 */
import {
  buildClinicalPrescriptionFromAtendimento,
  buildMemedItemsFromAtendimento,
} from '../src/lib/memed/buildClinicalPrescriptionFromAtendimento';
import { clinicalPrescriptionToMemedItems } from '../src/lib/memed/clinicalPrescriptionToMemedItems';

const BACKEND = process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app';
const ATENDIMENTO_ID = process.env.ATENDIMENTO_ID || 'c302bd9e-060a-4ee8-b4cf-0c78392f60c6';

/** Fallback quando API exige auth (PACIENTE TESTE 05 — Losartana 50mg). */
const C302_FALLBACK = {
  id: ATENDIMENTO_ID,
  paciente_nome: 'PACIENTE TESTE 05 - RENOVAÇÃO RECEITA',
  medicacao_em_uso: 'Losartana 50mg',
  dados_clinicos: {
    med1_nome: 'Losartana',
    med1_dose: '50mg',
    med1_frequencia: '24h',
    uso_continuo: true,
    medications: [
      { name: 'Losartana', dose: '50', unit: 'mg', frequency: '24h', continuous: true },
    ],
  },
};

async function fetchAtendimento() {
  try {
    const res = await fetch(`${BACKEND}/api/atendimentos/${ATENDIMENTO_ID}`);
    if (res.ok) return res.json();
  } catch {
    // offline — usa fallback
  }
  return C302_FALLBACK;
}

async function main() {
  const losartanaExample = clinicalPrescriptionToMemedItems([
    {
      medicamento: 'Losartana',
      concentracao: '50mg',
      forma: 'comprimido',
      via: 'oral',
      dose: '1 comprimido',
      frequencia: '24/24h',
      duracao: 'uso contínuo',
      uso_continuo: true,
      quantidade_sugerida: 30,
    },
  ]);

  const atendimento = await fetchAtendimento();
  const clinical = buildClinicalPrescriptionFromAtendimento(atendimento);
  const fromAtendimento = buildMemedItemsFromAtendimento(atendimento);

  console.log(
    JSON.stringify(
      {
        atendimentoId: ATENDIMENTO_ID,
        paciente: atendimento.paciente_nome || atendimento.nome,
        exemplo_oficial_losartana: losartanaExample,
        atendimento_clinical_items: clinical,
        atendimento_memed_result: fromAtendimento,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
