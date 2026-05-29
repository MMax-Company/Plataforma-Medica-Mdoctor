/**
 * Documentos oficiais Doctor Prescreve — URLs internas + rótulos amigáveis para o Typebot.
 * Não repetir URLs longas em blocos de texto do paciente; usar richLinkParagraph().
 */

const TYPEBOT_PUBLIC_ID = 'doctor-prescreve-8rmljgu';

const DOCUMENTS = {
  lgpd: {
    id: 'lgpd',
    label: 'Consentimento LGPD',
    emoji: '📄',
    url: 'https://thbwoogytwcidxrrboym.supabase.co/storage/v1/object/public/Documentos%20Doctor%20Prescreve/Consentimento_LGPD_Doctor_Prescreve.pdf',
    audience: 'patient'
  },
  privacy: {
    id: 'privacy',
    label: 'Política de Privacidade',
    emoji: '📄',
    url: 'https://thbwoogytwcidxrrboym.supabase.co/storage/v1/object/public/Documentos%20Doctor%20Prescreve/Politica_de_Privacidade_Doctor_Prescreve.pdf',
    audience: 'patient'
  },
  telemedicine: {
    id: 'telemedicine',
    label: 'Consentimento Telemedicina Assíncrona',
    emoji: '📄',
    url: 'https://thbwoogytwcidxrrboym.supabase.co/storage/v1/object/public/Documentos%20Doctor%20Prescreve/Consentimento_Telemedicina_Assincrona_Doctor_Prescreve.pdf',
    audience: 'patient'
  },
  nonUrgency: {
    id: 'non_urgency',
    label: 'Aviso Importante — Não Urgência/Emergência',
    emoji: '📄',
    url: 'https://thbwoogytwcidxrrboym.supabase.co/storage/v1/object/public/Documentos%20Doctor%20Prescreve/Aviso_Nao_Urgencia_Emergencia.pdf',
    audience: 'patient'
  },
  termsOfUse: {
    id: 'terms_of_use',
    label: 'Política e Termos de Uso',
    emoji: '📄',
    url: 'https://thbwoogytwcidxrrboym.supabase.co/storage/v1/object/public/Documentos%20Doctor%20Prescreve/Politica_e_termos_de_uso_Doctor_Prescreve.pdf',
    audience: 'patient'
  },
  manual: {
    id: 'manual',
    label: 'Manual Operacional',
    emoji: '📄',
    url: 'https://thbwoogytwcidxrrboym.supabase.co/storage/v1/object/public/Documentos%20Doctor%20Prescreve/Manual_Operacional_Doctor_Prescreve.pdf.pdf',
    audience: 'backoffice'
  },
  securityPolicy: {
    id: 'security_policy',
    label: 'Política de Segurança da Informação',
    emoji: '📄',
    url: 'https://thbwoogytwcidxrrboym.supabase.co/storage/v1/object/public/Documentos%20Doctor%20Prescreve/Politica_de_Seguranca_da_Informacao_Doctor_Prescreve%20(2).pdf',
    audience: 'backoffice'
  },
  physicianResponsibility: {
    id: 'physician_responsibility',
    label: 'Termo de responsabilidade médico',
    emoji: '📄',
    url: 'https://thbwoogytwcidxrrboym.supabase.co/storage/v1/object/public/Documentos%20Doctor%20Prescreve/termo_de_responsabilidade_medico_doctor_prescreve.pdf',
    audience: 'backoffice'
  }
};

const PATIENT_DOCUMENT_IDS = ['lgpd', 'privacy', 'telemedicine', 'non_urgency', 'terms_of_use'];

function docRef(key) {
  return DOCUMENTS[key];
}

function linksPayload(keys) {
  return keys.map((key) => {
    const d = DOCUMENTS[key];
    return { id: d.id, label: d.label, url: d.url };
  });
}

function termsPresentedPayload() {
  return PATIENT_DOCUMENT_IDS.map((id) => {
    const d = Object.values(DOCUMENTS).find((x) => x.id === id);
    return { id: d.id, label: d.label, url: d.url, step: stepForDocId(id) };
  });
}

function stepForDocId(id) {
  if (id === 'lgpd' || id === 'privacy') return 'lgpd';
  if (id === 'telemedicine' || id === 'non_urgency') return 'telemedicine';
  if (id === 'terms_of_use') return 'payment';
  return 'unknown';
}

function jsonForExpression(value) {
  return JSON.stringify(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function richLinkParagraph(docKey, uidFn) {
  const d = DOCUMENTS[docKey];
  const nextId = typeof uidFn === 'function' ? uidFn('p') : `p_${Math.random().toString(36).slice(2, 10)}`;
  return {
    id: nextId,
    type: 'p',
    children: [
      { text: `${d.emoji} ` },
      { type: 'a', url: d.url, target: '_blank', children: [{ text: d.label }] }
    ]
  };
}

function richPlainParagraph(text, uidFn) {
  const nextId = typeof uidFn === 'function' ? uidFn('p') : `p_${Math.random().toString(36).slice(2, 10)}`;
  return { id: nextId, type: 'p', children: [{ text }] };
}

function richDocumentList(docKeys, uidFn) {
  return docKeys.map((key) => richLinkParagraph(key, uidFn));
}

function collectBareSupabaseUrlsInTextBlocks(bot) {
  const violations = [];
  const re = /https?:\/\/[^\s]*supabase\.co[^\s]*/i;

  for (const group of bot.groups || []) {
    for (const block of group.blocks || []) {
      if (block.type === 'text') {
        walkRich(block.content?.richText, `${group.title} / text`);
      }
      if (block.type === 'choice input') {
        for (const item of block.items || []) {
          if (item.content && re.test(item.content)) {
            violations.push(`${group.title} / choice: ${item.content.slice(0, 40)}`);
          }
        }
      }
    }
  }

  function walkRich(nodes, where) {
    for (const node of nodes || []) {
      if (node.text && re.test(node.text)) {
        violations.push(`${where} (text node)`);
      }
      if (node.children) walkRich(node.children, where);
    }
  }

  return violations;
}

function webhookConsentFields() {
  const presented = JSON.stringify(termsPresentedPayload());
  return `
  "lgpd_accepted": "{{lgpd_accepted}}",
  "privacy_policy_accepted": "{{privacy_policy_accepted}}",
  "telemedicine_consent_accepted": "{{telemedicine_consent_accepted}}",
  "non_urgency_notice_accepted": "{{non_urgency_notice_accepted}}",
  "terms_of_use_accepted": "{{terms_of_use_accepted}}",
  "accepted_terms_at": "{{accepted_terms_at}}",
  "accepted_terms_links": "{{accepted_terms_links}}",
  "terms_presented": ${presented},
  "terms_accepted": "{{terms_accepted_summary}}",
  "typebot_public_id": "${TYPEBOT_PUBLIC_ID}"`;
}

module.exports = {
  TYPEBOT_PUBLIC_ID,
  DOCUMENTS,
  PATIENT_DOCUMENT_IDS,
  docRef,
  linksPayload,
  termsPresentedPayload,
  jsonForExpression,
  richLinkParagraph,
  richPlainParagraph,
  richDocumentList,
  collectBareSupabaseUrlsInTextBlocks,
  webhookConsentFields
};
