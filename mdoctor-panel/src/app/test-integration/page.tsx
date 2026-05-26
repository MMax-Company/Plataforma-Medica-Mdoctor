'use client';

import { useState } from 'react';
import { checkEligibility, type EligibilityRequest } from '@/services/api';

export default function TestIntegrationPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const testData: EligibilityRequest = {
    condition: 'hipertensao',
    previous_prescription: true,
    flags: []
  };

  const handleTest = async () => {
    setLoading(true);
    try {
      const response = await checkEligibility(testData);
      setResult(response);
    } catch (err: any) {
      setResult({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-[#1E1E1E] mb-6">🧪 Teste de Integração</h1>
        
        <div className="bg-white rounded-[20px] p-6 shadow border border-[#E5EAF2]">
          <pre className="bg-[#F8FAFC] p-4 rounded text-sm mb-4">
            {JSON.stringify(testData, null, 2)}
          </pre>
          <button
            onClick={handleTest}
            disabled={loading}
            className="w-full py-3 bg-[#1557FF] text-white rounded-[14px] font-semibold hover:bg-[#0E3DB3] transition disabled:opacity-50"
          >
            {loading ? 'Testando...' : '▶️ Testar Eligibility Engine'}
          </button>
        </div>

        {result && (
          <div className={`mt-4 p-4 rounded-[14px] border ${
            result.eligible ? 'bg-[#F0FFF4] border-[#0BA84F]' : 'bg-[#FFF0F0] border-[#FF2D2D]'
          }`}>
            <h3 className="font-semibold">{result.eligible ? '✅ Elegível' : '❌ Não Elegível'}</h3>
            <p className="text-sm"><strong>Motivo:</strong> {result.reason}</p>
          </div>
        )}
      </div>
    </div>
  );
}
