/**
 * Prepara a integração com GET/POST /v1/opcoes-receituario (tema de receituário
 * índice 1 — identidade visual Doctor Prescreve). NÃO É CHAMADO pelo fluxo
 * clínico/emissão de receita — é uma ação administrativa, de execução manual,
 * uma única vez por prescritor.
 *
 * Uso: node scripts/memed-configurar-opcoes-receituario.js
 *   (sem argumentos: só faz o GET e imprime a configuração atual — dry-run)
 *   --apply : faz o GET, mescla com a configuração pretendida e faz o POST
 *
 * Nunca sobrescreve o objeto inteiro: sempre mescla com o que a Memed já
 * devolve no GET, alterando somente os campos abaixo.
 */
require('dotenv').config();
const axios = require('axios');
const memed = require('../src/integrations/memed.service');

const DOCTOR_PRESCREVE_HEX = '#1557FF'; // mesma cor oficial usada no widget (--dp-blue)

const DESIRED_CONFIG = {
  indice: 1,
  fonte: 'Helvetica',
  tamanho_fonte: 12,
  espacamento: 24,

  mostrar_label_nome_paciente: true,
  mostrar_label_paciente_especial: 1,
  mostrar_data: 1,
  mostrar_data_controle_especial: 1,

  mostrar_unidades: true,
  mostrar_unidades_especial: true,
  separar_por_uso: true,
  mostrar_nome_fabricante: false,

  largura_papel: 21,
  altura_papel: 29.7,
  margem_esquerda: 1.5,
  margem_direita: 1.5,
  margem_superior: 1.5,
  margem_inferior: 1.5,

  titulo_fonte: 'Helvetica',
  titulo_tamanho_fonte: 16,
  titulo: 'Doctor Prescreve',
  titulo_cor: DOCTOR_PRESCREVE_HEX,

  subtitulo_fonte: 'Helvetica',
  subtitulo_tamanho_fonte: 10,
  subtitulo: 'Consulta médica assíncrona',
  subtitulo_cor: '#666666',

  rodape_fonte: 'Helvetica',
  rodape_tamanho_fonte: 8,
  rodape_cor: '#666666',

  tamanho_cabecalho: 3,
  tamanho_rodape: 2,

  mostrar_cabecalho_rodape_simples: 1,
  mostrar_cabecalho_rodape_especial: 1,

  modelo_cabecalho_rodape: 1,
  ativo: true,
  zoom_logo: 65,

  number_of_lme_copies: 1
};

function extractAttributes(payload) {
  if (!payload) return {};
  if (Array.isArray(payload.data)) return payload.data[0]?.attributes || {};
  return payload.data?.attributes || payload.attributes || payload || {};
}

async function getOpcoesReceituario(token) {
  const response = await axios.get(`${memed.baseUrl}/opcoes-receituario`, {
    params: { token },
    headers: { Accept: 'application/vnd.api+json', 'Content-Type': 'application/json' },
    validateStatus: (status) => status < 500
  });
  if (response.status >= 400) {
    throw new Error(`GET /opcoes-receituario falhou: HTTP ${response.status} ${JSON.stringify(response.data)}`);
  }
  return response.data;
}

async function postOpcoesReceituario(token, mergedAttributes) {
  const response = await axios.post(
    `${memed.baseUrl}/opcoes-receituario`,
    { data: { type: 'configuracoes-prescricao', attributes: mergedAttributes } },
    {
      params: { token },
      headers: { Accept: 'application/vnd.api+json', 'Content-Type': 'application/json' },
      validateStatus: (status) => status < 500
    }
  );
  if (response.status >= 400) {
    throw new Error(`POST /opcoes-receituario falhou: HTTP ${response.status} ${JSON.stringify(response.data)}`);
  }
  return response.data;
}

/**
 * Upload do PDF-template institucional (cabeçalho/rodapé) — POST
 * /v1/opcoes-receituario/upload-template. NÃO é chamado por padrão: exige
 * --template <caminho-do-pdf> explícito, e a arte (logotipo, texto exato do
 * rodapé) precisa estar aprovada antes de qualquer execução real.
 */
async function uploadTemplate(token, pdfPath) {
  const fs = require('fs');
  const FormData = require('form-data');
  const form = new FormData();
  form.append('template', fs.createReadStream(pdfPath));

  const response = await axios.post(`${memed.baseUrl}/opcoes-receituario/upload-template`, form, {
    params: { token },
    headers: { ...form.getHeaders() },
    validateStatus: (status) => status < 500
  });
  if (response.status >= 400) {
    throw new Error(`POST /opcoes-receituario/upload-template falhou: HTTP ${response.status} ${JSON.stringify(response.data)}`);
  }
  return response.data;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const templateIdx = process.argv.indexOf('--template');
  const templatePath = templateIdx !== -1 ? process.argv[templateIdx + 1] : null;

  if (!memed.hasCredentials()) {
    console.error('Credenciais Memed ausentes (MEMED_API_KEY/MEMED_SECRET_KEY) — abortando.');
    process.exit(1);
  }

  const auth = await memed.authenticatePrescriber(memed.buildDoctorFromEnv());
  const token = auth?.token;
  if (!token) throw new Error('Falha ao autenticar prescritor na Memed — sem token.');

  const current = await getOpcoesReceituario(token);
  const currentAttributes = extractAttributes(current);
  console.log('--- Configuração atual (GET /opcoes-receituario) ---');
  console.log(JSON.stringify(currentAttributes, null, 2));

  const merged = { ...currentAttributes, ...DESIRED_CONFIG };

  if (!apply) {
    console.log('\n--- Dry-run: nada foi enviado à Memed ---');
    console.log('Configuração que SERIA aplicada (execute com --apply para confirmar):');
    console.log(JSON.stringify(merged, null, 2));
    return;
  }

  console.log('\n--- Aplicando configuração mesclada (POST /opcoes-receituario) ---');
  const result = await postOpcoesReceituario(token, merged);
  console.log(JSON.stringify(result, null, 2));

  if (templatePath) {
    console.log(`\n--- Upload do template institucional (${templatePath}) ---`);
    const uploadResult = await uploadTemplate(token, templatePath);
    console.log(JSON.stringify(uploadResult, null, 2));
  }
  console.log('\nConcluído.');
}

main().catch((error) => {
  console.error('FALHOU:', error.message);
  process.exit(1);
});
