'use client';

import { FormEvent, useState } from 'react';
import { login } from '@/services/auth.service';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(username, password);
      window.location.href = '/fila';
    } catch (e: any) {
      setError(e.message || 'Falha no login');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-6 text-[#1E1E1E]">
      <section className="w-full max-w-md rounded-[20px] border border-[#E5EAF2] bg-white p-6 shadow-[0_8px_24px_rgba(0,0,0,0.06)]">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-[#1557FF] text-sm font-black text-white">
            DP
          </div>
          <div>
            <h1 className="text-lg font-black">Doctor Prescreve</h1>
            <p className="text-sm text-[#5B6475]">Acesso médico</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-[14px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-sm font-bold">
            Usuário
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              className="mt-2 h-11 w-full rounded-[14px] border border-[#E5EAF2] px-4 text-sm outline-none focus:border-[#1557FF]"
              required
            />
          </label>

          <label className="block text-sm font-bold">
            Senha
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              className="mt-2 h-11 w-full rounded-[14px] border border-[#E5EAF2] px-4 text-sm outline-none focus:border-[#1557FF]"
              required
            />
          </label>

          <button
            disabled={loading}
            className="h-11 w-full rounded-[14px] bg-[#1557FF] px-4 text-sm font-black text-white shadow-[0_2px_8px_rgba(0,0,0,0.06)] disabled:opacity-50"
          >
            {loading ? 'ENTRANDO...' : 'ENTRAR'}
          </button>
        </form>
      </section>
    </main>
  );
}
