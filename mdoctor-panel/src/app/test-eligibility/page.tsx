'use client';

import { useState } from 'react';
import { checkEligibility, type EligibilityRequest } from '@/services/eligibility.service';

export default function TestEligibilityPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const testData: EligibilityRequest = {
    condition: 'hipertensao',
    previous_prescription: true,
    continuous_use_proof: true,
    flags: []
  };

  const handleTest = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    
    try {
      const response = await checkEligibility(testData);
      setResult(response);
    } catch (err: any) {
      setError(err.message || 'Erro ao conectar com backend');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-[#1E1E1E] mb-6">
          🧪 Teste: Eligibility Engine
        </h1>
        
        <div className="bg-white rounded-[20px] p-6 shadow-[0_4px_24px_rgba(0,0,0,0.06)] border border-[#E5EAF2]">
          <h2 className="text-xl font-semibold text-[#1E1E1E] mb-4">
            Dados de Teste
          </h2>
          <pre className="bg-[#F8FAFC] p-4 rounded-lg text-sm text-[#5B6475] overflow-auto">
            {JSON.stringify(testData, null, 2)}
          </pre>
          
          <button
            onClick={handleTest}
            disabled={loading}
            className="mt-4 w-full py-3 bg-[#1557FF] hover:bg-[#0E3DB3] text-white rounded-[14px] font-semibold transition disabled:opacity-50"
          >
            {loading ? 'Testando...' : '▶️ Testar Elegibilidade'}
          </button>
        </div>

        {error && (
          <div className="mt-4 p-4 bg-[#FFF0F0] border border-[#FF2D2D] rounded-[14px] text-[#FF2D2D]">
            ❌ Erro: {error}
          </div>
        )}

        {result && (
          <div className={`mt-4 p-4 rounded-[14px] border ${
            result.eligible 
              ? 'bg-[#F0FFF4] border-[#0BA84F] text-[#0BA84F]' 
              : 'bg-[#FFF0F0] border-[#FF2D2D] text-[#FF2D2D]'
          }`}>
            <h3 className="font-semibold mb-2">
              {result.eligible ? '✅ Elegível' : '❌ Não Elegível'}
            </h3>
            <p className="text-sm mb-2"><strong>Motivo:</strong> {result.reason}</p>
            <p className="text-xs text-[#5B6475]">
              <strong>Timestamp:</strong> {new Date(result.timestamp).toLocaleString('pt-BR')}
            </p>
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-[#1557FF]">Ver resposta completa</summary>
              <pre className="mt-2 bg-white p-3 rounded border overflow-auto">
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
