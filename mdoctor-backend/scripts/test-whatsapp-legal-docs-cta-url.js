const assert = require('assert');
const { convertTypebotResponse } = require('../src/services/typebot-whatsapp.bridge');

function main() {
  // Fixture equivalente ao bloco real de LGPD do Typebot publicado
  // (docs/typebot/typebot-doctor-prescreve-staging-safe.json, blk_lgpd_docs).
  const response = {
    messages: [
      {
        type: 'text',
        content: {
          richText: [
            { id: 'p1', type: 'p', children: [{ text: 'Antes de continuar, leia os documentos abaixo:' }] }
          ]
        }
      },
      {
        type: 'text',
        content: {
          richText: [
            {
              id: 'p2',
              type: 'p',
              children: [
                { text: '📄 ' },
                {
                  type: 'a',
                  url: 'https://usihurogvphtjedyhyfl.supabase.co/storage/v1/object/public/Documentos%20Doctor%20Prescreve/Consentimento_LGPD_Doctor_Prescreve.pdf',
                  target: '_blank',
                  children: [{ text: 'Consentimento LGPD' }]
                }
              ]
            },
            {
              id: 'p3',
              type: 'p',
              children: [
                { text: '📄 ' },
                {
                  type: 'a',
                  url: 'https://usihurogvphtjedyhyfl.supabase.co/storage/v1/object/public/Documentos%20Doctor%20Prescreve/Politica_de_Privacidade_Doctor_Prescreve.pdf',
                  target: '_blank',
                  children: [{ text: 'Política de Privacidade' }]
                }
              ]
            }
          ]
        }
      },
      {
        type: 'text',
        content: {
          richText: [
            { id: 'p4', type: 'p', children: [{ text: 'Ao continuar, você autoriza o tratamento dos seus dados pessoais e de saúde para fins de triagem, atendimento, prontuário e emissão de receita digital.' }] }
          ]
        }
      }
    ],
    input: {
      type: 'choice input',
      id: 'ivbr3o1a7lv8izhfteuerhqx',
      items: [
        { id: 'rx2ibesgrkoewo6gw5ah1d16', content: 'Autorizo', value: 'sim' },
        { id: 'pco3gbkf4qv9250dxhdrgpo4', content: 'Não autorizo', value: 'nao' }
      ]
    }
  };

  const outputs = convertTypebotResponse(response);

  const documents = outputs.filter((o) => o.kind === 'document');
  assert.equal(documents.length, 2, 'esperado 2 botões de documento (LGPD + Política de Privacidade)');

  assert.equal(documents[0].label, 'Consentimento LGPD');
  assert.equal(documents[0].url, 'https://usihurogvphtjedyhyfl.supabase.co/storage/v1/object/public/Documentos%20Doctor%20Prescreve/Consentimento_LGPD_Doctor_Prescreve.pdf');
  assert.equal(documents[0].introText, 'Antes de continuar, leia os documentos abaixo:');

  assert.equal(documents[1].label, 'Política de Privacidade');
  assert.equal(documents[1].introText, null, 'segundo botão não deve repetir a introdução');

  // Corpo nunca vazio (evita erro Meta 131008): primeiro botão usa a
  // introdução, os seguintes usam o ícone neutro.
  for (const doc of documents) {
    const body = doc.introText || '📄';
    assert(body.length > 0, 'corpo do botão cta_url não pode ficar vazio');
  }

  // Nenhuma URL crua sobra em mensagens de texto simples.
  const textOutputs = outputs.filter((o) => o.kind === 'text');
  for (const t of textOutputs) {
    assert(!/https?:\/\//.test(t.text), `mensagem de texto não deveria conter URL crua: ${t.text}`);
  }

  // Botões de consentimento (Autorizo/Não autorizo) continuam vindo do
  // choice input, sem alteração desta correção.
  assert.equal(response.input.items[0].content, 'Autorizo');
  assert.equal(response.input.items[0].value, 'sim');
  assert.equal(response.input.items[1].content, 'Não autorizo');
  assert.equal(response.input.items[1].value, 'nao');

  console.log(JSON.stringify({
    ok: true,
    legalDocsAsCtaUrl: true,
    documentCount: documents.length,
    documentLabels: documents.map((d) => d.label),
    noRawUrlInText: true
  }, null, 2));
}

main();
