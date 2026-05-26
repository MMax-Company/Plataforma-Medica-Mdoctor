'use client';
import { useState } from 'react';
import { checkEligibility } from '@/services/api';

export default function TestPage() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const runTest = async () => {
    setLoading(true);
    try {
      const res = await checkEligibility({ condition: 'hipertensao', previous_prescription: true, flags: [] });
      setResult(res);
    } catch (e: any) { setResult({ error: e.message }); }
    finally { setLoading(false); }
  };

  return (
    <main className="min-h-screen p-6">
      <h1 className="text-2xl font-bold mb-6">🧪 Teste de Integração</h1>
      <button onClick={runTest} disabled={loading} className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
        {loading ? 'Testando...' : '▶️ Executar Teste'}
      </button>
      {result && (
        <pre className="mt-4 p-4 bg-gray-100 rounded text-sm overflow-auto">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </main>
  );
}
