// src/integrations/memed.service.js
const axios = require('axios');
const crypto = require('crypto');

class MemedService {
  constructor() {
    this.apiKey = process.env.MEMED_API_KEY;
    this.secretKey = process.env.MEMED_SECRET_KEY;
    this.env = process.env.MEMED_ENVIRONMENT || process.env.MEMED_ENV || 'development';
    this.baseUrl =
      process.env.MEMED_API_URL ||
      (this.env === 'production' ? 'https://api.memed.com.br/v1' : 'https://integrations.api.memed.com.br/v1');
    this.tokenCache = {
      token: null,
      expiresAt: null,
      prescriber: null
    };
  }

  hasCredentials() {
    return Boolean(this.apiKey && this.secretKey && this.apiKey !== 'sua_chave');
  }

  hasStaticToken() {
    return Boolean(process.env.MEMED_PRESCRITOR_TOKEN || process.env.NEXT_PUBLIC_MEMED_TOKEN);
  }

  async authenticatePrescriber(doctor) {
    if (this.tokenCache.token && this.tokenCache.expiresAt > Date.now()) {
      return {
        token: this.tokenCache.token,
        prescriber: this.tokenCache.prescriber
      };
    }

    if (!this.hasCredentials()) {
      const token = process.env.MEMED_PRESCRITOR_TOKEN || process.env.NEXT_PUBLIC_MEMED_TOKEN;
      if (token) {
        return {
          token,
          prescriber: {
            id: doctor.external_id || doctor.crm || 'static-token',
            nome: doctor.nome || process.env.MEDICO_NOME || 'Prescritor',
            crm: doctor.crm,
            uf: doctor.uf,
            mode: 'static-token'
          }
        };
      }
      throw new Error('Credenciais Memed não configuradas');
    }

    if (!doctor.crm || !doctor.uf) {
      throw new Error('CRM e UF são obrigatórios para autenticar o prescritor');
    }

    const prescriber = await this.findOrCreatePrescriber(doctor);
    const token =
      prescriber.token ||
      prescriber.attributes?.token ||
      prescriber.attributes?.token_acesso ||
      process.env.MEMED_PRESCRITOR_TOKEN ||
      process.env.NEXT_PUBLIC_MEMED_TOKEN ||
      '';

    const result = {
      token,
      prescriber: {
        id: prescriber.id || prescriber.external_id || doctor.external_id,
        nome: prescriber.nome || doctor.nome,
        crm: doctor.crm,
        uf: doctor.uf
      }
    };

    this.tokenCache = {
      token,
      expiresAt: Date.now() + 55 * 60 * 1000,
      prescriber: result.prescriber
    };

    return result;
  }

  normalizeBirthDate(value) {
    const raw = String(value || process.env.MEMED_PRESCRITOR_DATA_NASC || process.env.MEDICO_DATA_NASC || '').trim();
    if (!raw) return '';
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    return raw;
  }

  prescriberLookupId(doctor) {
    const externalId = String(doctor.external_id || process.env.MEMED_PRESCRITOR_EXTERNAL_ID || '').trim();
    if (externalId) return externalId;
    if (!doctor.crm || !doctor.uf) return '';
    return `${String(doctor.crm).replace(/\D/g, '')}${String(doctor.uf).toUpperCase()}`;
  }

  async findOrCreatePrescriber(doctor) {
    const id = this.prescriberLookupId(doctor);
    if (!id) throw new Error('external_id ou CRM/UF são obrigatórios para localizar o prescritor');

    try {
      const response = await axios.get(`${this.baseUrl}/sinapse-prescricao/usuarios/${encodeURIComponent(id)}`, {
        headers: {
          Accept: 'application/vnd.api+json',
          'Content-Type': 'application/json'
        },
        params: {
          'api-key': this.apiKey,
          'secret-key': this.secretKey
        }
      });

      return response.data?.data?.attributes || response.data?.data || response.data;
    } catch (error) {
      if (error.response?.status !== 404) throw error;
      return this.createPrescriber(doctor);
    }
  }

  async createPrescriber(doctor) {
    const nameParts = String(doctor.nome || '').trim().split(/\s+/);
    const cidadeId = Number(process.env.MEMED_CIDADE_ID || 0);
    const especialidadeId = Number(process.env.MEMED_ESPECIALIDADE_ID || 0);
    const attributes = {
      external_id: doctor.external_id || process.env.MEMED_PRESCRITOR_EXTERNAL_ID || crypto.randomUUID(),
      nome: nameParts[0] || process.env.MEMED_PRESCRITOR_NOME || process.env.MEDICO_NOME || 'Prescritor',
      sobrenome:
        nameParts.slice(1).join(' ') ||
        process.env.MEMED_PRESCRITOR_SOBRENOME ||
        process.env.MEDICO_SOBRENOME ||
        'MDoctor',
      cpf: String(doctor.cpf || process.env.MEMED_PRESCRITOR_CPF || process.env.MEDICO_CPF || '').replace(/\D/g, ''),
      board: {
        board_code: process.env.MEMED_PRESCRITOR_BOARD_CODE || 'CRM',
        board_number: String(doctor.crm || process.env.MEMED_PRESCRITOR_BOARD_NUMBER || '').replace(/\D/g, ''),
        board_state: String(doctor.uf || process.env.MEMED_PRESCRITOR_BOARD_STATE || '').toUpperCase()
      },
      email: doctor.email || process.env.MEMED_PRESCRITOR_EMAIL || process.env.MEDICO_EMAIL || '',
      telefone: String(doctor.telefone || process.env.MEMED_PRESCRITOR_TELEFONE || process.env.MEDICO_TELEFONE || '').replace(
        /\D/g,
        ''
      ),
      sexo: doctor.sexo || process.env.MEMED_PRESCRITOR_SEXO || process.env.MEDICO_SEXO || 'M',
      data_nascimento: this.normalizeBirthDate(doctor.data_nascimento)
    };
    if (cidadeId > 0) attributes.cidade_id = cidadeId;
    if (especialidadeId > 0) attributes.especialidade_id = especialidadeId;

    const payload = {
      data: {
        type: 'usuarios',
        attributes
      }
    };

    const response = await axios.post(`${this.baseUrl}/sinapse-prescricao/usuarios`, payload, {
      headers: {
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/json'
      },
      params: {
        'api-key': this.apiKey,
        'secret-key': this.secretKey
      }
    });

    return response.data?.data?.attributes || response.data?.data || response.data;
  }

  validateToken(token) {
    return {
      valid: Boolean(token && String(token).split('.').length === 3),
      error: token ? undefined : 'Token não fornecido'
    };
  }

  /**
   * @deprecated Não é fluxo oficial. Emissão: widget Sinapse + POST /api/memed/receita.
   */
  async createPrescription(data) {
    if (process.env.MEMED_ALLOW_LEGACY_REST !== 'true') {
      return {
        success: false,
        error:
          'Emissão REST descontinuada. Use widget Memed/Sinapse no painel e POST /api/memed/receita após confirmação do médico.',
        code: 'MEMED_REST_EMISSION_DEPRECATED'
      };
    }

    try {
      if (!this.hasCredentials()) {
        return { success: false, error: 'MEMED_API_KEY não configurada' };
      }

      const auth = await this.authenticatePrescriber({
        external_id: data.external_id || process.env.MEMED_PRESCRITOR_EXTERNAL_ID,
        nome:
          data.doctorName ||
          `${process.env.MEMED_PRESCRITOR_NOME || ''} ${process.env.MEMED_PRESCRITOR_SOBRENOME || ''}`.trim(),
        cpf: data.doctorCpf || process.env.MEMED_PRESCRITOR_CPF || process.env.MEDICO_CPF,
        crm: data.doctorCrm || process.env.MEMED_PRESCRITOR_BOARD_NUMBER,
        uf: data.doctorUf || process.env.MEMED_PRESCRITOR_BOARD_STATE,
        email: data.doctorEmail || process.env.MEMED_PRESCRITOR_EMAIL,
        telefone: data.doctorPhone || process.env.MEMED_PRESCRITOR_TELEFONE
      });

      const payload = {
        patient: {
          name: data.patientName,
          document: data.patientDocument, // CPF
          birth_date: data.patientBirthDate,
          phone: data.patientPhone,
          email: data.patientEmail
        },
        professional: {
          name: data.doctorName,
          document: data.doctorCrm,
          uf: data.doctorUf
        },
        prescription: {
          medications: data.medications, // array de medicamentos
          notes: data.notes || ''
        },
        environment: this.env
      };

      const response = await axios.post(`${this.baseUrl}/prescriptions`, payload, {
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json'
        },
        params: { 'api-key': this.apiKey, 'secret-key': this.secretKey }
      });

      return {
        success: true,
        prescriptionId: response.data.id,
        pdfUrl: response.data.pdf_url,
        data: response.data
      };
    } catch (error) {
      const detail = error.response?.data?.errors?.[0]?.detail || error.response?.data?.message;
      return {
        success: false,
        error: detail || 'Erro ao criar receita',
        httpStatus: error.response?.status || null
      };
    }
  }

  async getPrescriptionById(prescriptionId) {
    try {
      if (!this.hasCredentials()) {
        return { success: false, error: 'MEMED_API_KEY não configurada' };
      }

      const response = await axios.get(`${this.baseUrl}/prescriptions/${prescriptionId}`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` }
      });
      return { success: true, data: response.data };
    } catch (error) {
      console.error('❌ Erro ao buscar receita:', error.message);
      return { success: false, error: error.message };
    }
  }

  async downloadPdf(prescriptionId) {
    try {
      if (!this.hasCredentials()) {
        return { success: false, error: 'MEMED_API_KEY não configurada' };
      }

      const response = await axios.get(`${this.baseUrl}/prescriptions/${prescriptionId}/pdf`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        responseType: 'arraybuffer'
      });
      return { success: true, pdf: Buffer.from(response.data, 'binary') };
    } catch (error) {
      console.error('❌ Erro ao baixar PDF:', error.message);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new MemedService();
