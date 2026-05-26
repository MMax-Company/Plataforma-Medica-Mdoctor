// src/config/supabase.js
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

let supabase = null;
let initialized = false;

function initSupabase() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const key = serviceKey || (process.env.NODE_ENV === 'production' ? '' : process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY);
  const hasPlaceholder = !url || url.includes('SEU_PROJETO') || !key || key.includes('...');

  if (process.env.NODE_ENV === 'production' && !serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_SERVICE_KEY obrigatório no backend em produção');
  }

  if (!hasPlaceholder && url.startsWith('https://')) {
    supabase = createClient(url, key, {
      auth: { persistSession: false },
      realtime: { transport: WebSocket }
    });
    initialized = true;
    console.log('✅ Supabase conectado (PostgreSQL + Storage + Auth)');
    return true;
  } else {
    supabase = null;
    initialized = true;
    console.log('⚠️ Supabase não configurado. Backend em modo desenvolvimento.');
    return false;
  }
}

function getSupabase() {
  if (!supabase) throw new Error('Supabase não inicializado. Configure SUPABASE_URL e SUPABASE_KEY.');
  return supabase;
}

function canUseLocalFallback() {
  return process.env.NODE_ENV !== 'production' && process.env.DISABLE_LOCAL_DB_FALLBACK !== 'true';
}

function assertCanFallback(context, error) {
  if (canUseLocalFallback()) return;
  const details = error?.message ? `: ${error.message}` : '';
  throw new Error(`Persistencia Supabase obrigatoria falhou em ${context}${details}`);
}

module.exports = {
  assertCanFallback,
  canUseLocalFallback,
  getSupabase,
  initSupabase,
  isInitialized: () => initialized
};
