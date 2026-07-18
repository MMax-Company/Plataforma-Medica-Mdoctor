#!/usr/bin/env node
require('./load-dotenv');
const {
  createViewSignedUrl,
  resolvePreviousPrescriptionStoragePath
} = require('../src/services/previous-prescription-storage.service');
const { parseBrazilianAddress } = require('../src/services/typebot-clinical-data.validation');
const { getAtendimento, updateAtendimentoStatus } = require('../src/store/atendimentos.store');

const ATENDIMENTO_ID = '78399c26-9e4c-46e3-bb17-9bef845c7002';

async function main() {
  const atendimento = await getAtendimento(ATENDIMENTO_ID);
  if (!atendimento) throw new Error('Atendimento não encontrado');

  const clinical = { ...(atendimento.dados_clinicos || {}) };
  const parsed = parseBrazilianAddress(clinical.address || 'Rua Aurora, 965, Santa Ifigenia Sao, Paulo, SP');
  const address_structured = {
    rua: parsed?.rua || 'Rua Aurora',
    numero: parsed?.numero || '965',
    bairro: parsed?.bairro || 'Santa Ifigênia',
    cidade: parsed?.cidade || 'São Paulo',
    estado: parsed?.estado || 'SP',
    cep: clinical.cep || '01209003'
  };
  const address = `${address_structured.rua}, ${address_structured.numero}, ${address_structured.bairro}, ${address_structured.cidade}, ${address_structured.estado}`;

  const storagePath = await resolvePreviousPrescriptionStoragePath(ATENDIMENTO_ID, clinical);
  if (!storagePath) throw new Error('Nenhum arquivo de receita encontrado no storage');

  const viewUrl = await createViewSignedUrl(storagePath);
  const patchedClinical = {
    ...clinical,
    address,
    address_structured,
    previous_prescription_storage_path: storagePath,
    previous_prescription_url: viewUrl,
    previous_prescription_file: viewUrl,
    foto_receita_url: viewUrl,
    previous_prescription: true,
    has_previous_prescription: true,
    receita_anterior: true,
    prescription_upload_pending: false,
    prescription_ingest: { ok: true, storage_path: storagePath, source: 'staging_fix' }
  };

  await updateAtendimentoStatus(ATENDIMENTO_ID, atendimento.status, {
    dados_clinicos: patchedClinical,
    paciente_cep: address_structured.cep
  });

  console.log(
    JSON.stringify(
      {
        atendimento_id: ATENDIMENTO_ID,
        storage_path: storagePath,
        address,
        address_structured
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
