require('dotenv').config();
const { exec } = require('child_process');
console.log(' Iniciando n8n na porta ' + process.env.N8N_PORT + '...');
const n8n = exec(`npx n8n start --port ${process.env.N8N_PORT} --host ${process.env.N8N_HOST}`, { stdio: 'inherit' });
n8n.on('error', (err) => console.error('❌ Erro n8n:', err));
