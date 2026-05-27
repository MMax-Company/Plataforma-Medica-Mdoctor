'use client';
import { useEffect, useState } from 'react';
import { API_BASE } from '@/config/api';

export default function WhatsAppStatusPage() {
  const [status, setStatus] = useState<any>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/whatsapp/status`);
        const data = await res.json();
        setStatus(data);
      } catch (e) { console.error('Erro:', e); }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <main className="min-h-screen p-6 bg-gray-50">
      <h1 className="text-2xl font-bold mb-6">📱 Status WhatsApp</h1>
      {status ? (
        <div className="bg-white p-6 rounded-lg shadow">
          <p className="text-lg">Conexão: <span className={status.connected ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>
            {status.connected ? '✅ Conectado' : '❌ Desconectado'}
          </span></p>
          <p className="text-sm text-gray-500 mt-2">Última verificação: {new Date(status.timestamp).toLocaleString()}</p>
        </div>
      ) : (
        <p>Carregando...</p>
      )}
    </main>
  );
}
