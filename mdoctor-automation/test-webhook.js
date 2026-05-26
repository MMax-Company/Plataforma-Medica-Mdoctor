require('dotenv').config();
const axios = require('axios');

async function test() {
  const baseUrl = process.env.AUTOMATION_URL || `http://localhost:${process.env.PORT || process.env.N8N_PORT || 5678}`;
  const headers = process.env.AUTOMATION_WEBHOOK_SECRET
    ? { 'x-automation-secret': process.env.AUTOMATION_WEBHOOK_SECRET }
    : {};

  console.log('Testando webhook automation...');
  try {
    const res = await axios.post(`${baseUrl}/webhook/whatsapp`, {
      from: '5511999999999@s.whatsapp.net',
      text: 'renovar'
    }, { timeout: 8000, headers });
    console.log('Status:', res.status);
    console.log('Dados:', JSON.stringify(res.data, null, 2));
  } catch (e) {
    console.error('Erro rede:', e.message);
    if (e.response) {
      console.error('Resposta erro:', e.response.status, e.response.data);
    }
  }
}
test();
