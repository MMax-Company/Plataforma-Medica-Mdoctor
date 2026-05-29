function pick(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function validateNestedTriagemPayload(body = {}) {
  const paciente = body.paciente && typeof body.paciente === 'object' ? body.paciente : null;
  const triagem = body.triagem && typeof body.triagem === 'object' ? body.triagem : null;

  if (!paciente || !triagem) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        message: 'Payload deve conter objetos paciente e triagem'
      }
    };
  }

  const nome = pick(paciente.nome);
  const telefone = digits(paciente.telefone);
  const doencas = pick(triagem.doencas);

  const missing = [];
  if (!nome) missing.push('paciente.nome');
  if (!telefone) missing.push('paciente.telefone');
  if (!doencas) missing.push('triagem.doencas');

  if (missing.length) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        message: `Campos obrigatórios ausentes: ${missing.join(', ')}`
      }
    };
  }

  return {
    ok: true,
    paciente: {
      nome,
      telefone,
      cpf: digits(paciente.cpf),
      email: pick(paciente.email),
      data_nascimento: pick(paciente.data_nascimento, paciente.birth_date),
      endereco: pick(paciente.endereco, paciente.address),
      cep: pick(paciente.cep)
    },
    triagem: {
      doencas,
      medicacao_em_uso: pick(triagem.medicacao_em_uso),
      tempo_uso: pick(triagem.tempo_uso),
      receita_anterior: pick(triagem.receita_anterior),
      sinais_alerta: pick(triagem.sinais_alerta),
      observacoes: pick(triagem.observacoes)
    }
  };
}

function nestedTriagemToTypebotFlatBody(paciente, triagem) {
  const medication = triagem.medicacao_em_uso || 'Medicamento informado na triagem';
  const medicationParts = medication.split(/\s+/).filter(Boolean);
  const medName = medicationParts[0] || medication;

  return {
    patient_name: paciente.nome,
    nome: paciente.nome,
    Nome_Completo: paciente.nome,
    whatsapp: paciente.telefone,
    telefone: paciente.telefone,
    from: paciente.telefone,
    cpf: paciente.cpf || '00000000000',
    cpf_paciente: paciente.cpf || '00000000000',
    email: paciente.email || 'triagem@doctorprescreve.local',
    Email: paciente.email || 'triagem@doctorprescreve.local',
    address: paciente.endereco || 'Endereço pendente — triagem Typebot',
    Endereco: paciente.endereco || 'Endereço pendente — triagem Typebot',
    cep: paciente.cep || '01310100',
    birth_date: paciente.data_nascimento || '01/01/1980',
    data_nascimento: paciente.data_nascimento || '01/01/1980',
    doenca_cronica: triagem.doencas,
    chronic_condition: triagem.doencas,
    medicacao_em_uso: medication,
    primeiro_medicamento: medication,
    medication_name: medication,
    med1_nome: medName,
    med1_dose: medicationParts[1] || '',
    med1_frequencia: '',
    med1_via: 'oral',
    tempo_uso: triagem.tempo_uso || 'mais de 30 dias',
    has_previous_prescription: triagem.receita_anterior || 'sim',
    receita_anterior: triagem.receita_anterior || 'sim',
    sinais_alerta: triagem.sinais_alerta || 'não',
    text: triagem.observacoes || `Triagem Typebot — ${triagem.doencas}`,
    source: 'typebot-triagem',
    protocol: 'typebot-triagem-v1',
    pagamento_status: 'PENDENTE',
    payment_status: 'unpaid'
  };
}

module.exports = {
  validateNestedTriagemPayload,
  nestedTriagemToTypebotFlatBody
};
