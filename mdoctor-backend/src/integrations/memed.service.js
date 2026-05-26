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

  async findOrCreatePrescriber(doctor) {
    const id = `${String(doctor.crm).replace(/\D/g, '')}${String(doctor.uf).toUpperCase()}`;

    try {
      const response = await axios.get(`${this.baseUrl}/sinapse-prescricao/usuarios/${id}`, {
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
    const payload = {
      data: {
        type: 'usuarios',
        attributes: {
          external_id: doctor.external_id || crypto.randomUUID(),
          nome: nameParts[0] || process.env.MEDICO_NOME || 'Prescritor',
          sobrenome: nameParts.slice(1).join(' ') || process.env.MEDICO_SOBRENOME || 'MDoctor',
          cpf: String(doctor.cpf || '').replace(/\D/g, ''),
          board: {
            board_code: process.env.MEMED_PRESCRITOR_BOARD_CODE || 'CRM',
            board_number: String(doctor.crm || '').replace(/\D/g, ''),
            board_state: String(doctor.uf || '').toUpperCase()
          },
          email: doctor.email || '',
          telefone: String(doctor.telefone || '').replace(/\D/g, ''),
          sexo: doctor.sexo || 'M',
          data_nascimento: doctor.data_nascimento || ''
        }
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

  async createPrescription(data) {
    try {
      if (!this.hasCredentials()) {
        return { success: false, error: 'MEMED_API_KEY não configurada' };
      }

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
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        params: { 'api-key': this.apiKey, 'secret-key': this.secretKey }
      });

      console.log('✅ Receita criada na Memed:', response.data.id);
      return {
        success: true,
        prescriptionId: response.data.id,
        pdfUrl: response.data.pdf_url,
        data: response.data
      };
    } catch (error) {
      console.error('❌ Erro ao criar receita Memed:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || 'Erro ao criar receita'
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
