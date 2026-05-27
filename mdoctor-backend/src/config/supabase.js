// src/config/supabase.js
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

let supabase = null;
let initialized = false;
let lastConnectionError = null;

function hasValue(value) {
  return Boolean(String(value || '').trim());
}

function getServiceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
}

function getAnonKey() {
  return process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '';
}

function isPlaceholder(value) {
  return !hasValue(value) || String(value).includes('SEU_PROJETO') || String(value).includes('...');
}

function getSupabaseBuckets() {
  return {
    documents: process.env.SUPABASE_BUCKET_DOCUMENTS || 'documents',
    prescriptions: process.env.SUPABASE_BUCKET_PRESCRIPTIONS || 'prescriptions',
    medicalRecords: process.env.SUPABASE_BUCKET_MEDICAL_RECORDS || 'medical-records',
    consents: process.env.SUPABASE_BUCKET_CONSENTS || 'consents',
    logs: process.env.SUPABASE_BUCKET_LOGS || 'logs'
  };
}

function isSupabaseConfigured() {
  const url = process.env.SUPABASE_URL;
  const key = getServiceKey() || (process.env.NODE_ENV === 'production' ? '' : getAnonKey());
  return !isPlaceholder(url) && !isPlaceholder(key) && String(url).startsWith('https://');
}

function initSupabase() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = getServiceKey();
  const key = serviceKey || (process.env.NODE_ENV === 'production' ? '' : getAnonKey());

  if (process.env.NODE_ENV === 'production' && !serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_SERVICE_KEY obrigatório no backend em produção');
  }

  if (isSupabaseConfigured()) {
    supabase = createClient(url, key, {
      auth: { persistSession: false },
      realtime: { transport: WebSocket }
    });
    initialized = true;
    lastConnectionError = null;
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

function reportSupabaseError(error) {
  lastConnectionError = error?.message || String(error || 'Erro desconhecido no Supabase');
}

async function pingSupabase() {
  if (!supabase) {
    return { configured: isSupabaseConfigured(), responding: false, mode: 'fallback_local', error: lastConnectionError };
  }

  const { error } = await supabase.from('atendimentos').select('id', { count: 'exact', head: true }).limit(1);
  if (error) {
    reportSupabaseError(error);
    return { configured: true, responding: false, mode: canUseLocalFallback() ? 'fallback_local' : 'supabase', error: error.message };
  }

  lastConnectionError = null;
  return { configured: true, responding: true, mode: 'supabase', error: null };
}

function getSupabaseStatus() {
  return {
    configured: isSupabaseConfigured(),
    initialized,
    responding: Boolean(supabase && !lastConnectionError),
    mode: supabase && !lastConnectionError ? 'supabase' : 'fallback_local',
    buckets: getSupabaseBuckets(),
    error: lastConnectionError
  };
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
  getSupabaseBuckets,
  getSupabaseStatus,
  getSupabase,
  initSupabase,
  isInitialized: () => initialized,
  isSupabaseConfigured,
  pingSupabase,
  reportSupabaseError
};
