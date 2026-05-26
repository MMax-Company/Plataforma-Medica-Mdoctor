require('dotenv').config();
const axios = require('axios');

async function test() {
  const backendUrl = (process.env.BACKEND_URL || 'http://localhost:3004').replace(/\/+$/, '');
  console.log('Testando pipeline backend...');
  const res = await axios
    .post(`${backendUrl}/api/whatsapp/webhook`, {
      from: '5511999999999@s.whatsapp.net',
      text: 'renovar'
    }, { timeout: 8000 })
    .catch((e) => ({ data: { error: e.message } }));

  console.log(res.data?.error ? `Erro: ${res.data.error}` : `Reply: ${res.data.reply?.substring(0, 80)}...`);
}
test();
