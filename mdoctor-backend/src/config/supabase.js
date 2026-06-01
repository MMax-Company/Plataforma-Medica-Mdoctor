// src/config/supabase.js — persistência obrigatória (sem fallback in-memory)
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

function isPlaceholder(value) {
  return !hasValue(value) || String(value).includes('SEU_PROJETO') || String(value).includes('...');
}

function getSupabaseBuckets() {
  return {
    receitas: process.env.SUPABASE_BUCKET_RECEITAS || 'receitas',
    uploads: process.env.SUPABASE_BUCKET_UPLOADS || 'uploads',
    prontuarios: process.env.SUPABASE_BUCKET_PRONTUARIOS || 'prontuarios',
    anexos: process.env.SUPABASE_BUCKET_ANEXOS || 'anexos',
    receitasAntigas:
      process.env.SUPABASE_BUCKET_RECEITAS_ANTERIORES ||
      process.env.SUPABASE_RECEITAS_ANTERIORES_BUCKET ||
      'receitas-antigas',
    documentosClinicos: process.env.SUPABASE_BUCKET_DOCUMENTOS_CLINICOS || 'documentos-clinicos',
    documents: process.env.SUPABASE_BUCKET_DOCUMENTS || 'documentos-clinicos',
    prescriptions: process.env.SUPABASE_BUCKET_PRESCRIPTIONS || 'receitas',
    previousPrescriptions:
      process.env.SUPABASE_BUCKET_RECEITAS_ANTERIORES || 'receitas-antigas',
    medicalRecords: process.env.SUPABASE_BUCKET_MEDICAL_RECORDS || 'prontuarios',
    consents: process.env.SUPABASE_BUCKET_CONSENTS || 'documentos-clinicos',
    logs: process.env.SUPABASE_BUCKET_LOGS || 'anexos'
  };
}

function isSupabaseConfigured() {
  const url = process.env.SUPABASE_URL;
  const key = getServiceKey();
  return !isPlaceholder(url) && !isPlaceholder(key) && String(url).startsWith('https://');
}

function initSupabase() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = getServiceKey();

  if (!serviceKey) {
    const strict =
      process.env.NODE_ENV === 'production' ||
      process.env.ENVIRONMENT_NAME === 'staging' ||
      process.env.SUPABASE_REQUIRED === 'true';
    if (strict) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY obrigatória — persistência in-memory desativada');
    }
  }

  if (isSupabaseConfigured()) {
    supabase = createClient(url, serviceKey, {
      auth: { persistSession: false },
      realtime: { transport: WebSocket }
    });
    initialized = true;
    lastConnectionError = null;
    console.log('✅ Supabase conectado (persistência oficial)');
    return true;
  }

  supabase = null;
  initialized = true;
  const optional = process.env.SUPABASE_PERSISTENCE_OPTIONAL === 'true';
  if (!optional) {
    console.error('❌ Supabase não configurado — backend exige banco (SUPABASE_PERSISTENCE_OPTIONAL=true só para testes locais)');
  } else {
    console.warn('⚠️ Supabase não configurado (modo opcional explícito)');
  }
  return false;
}

function getSupabase() {
  if (!supabase) {
    throw new Error(
      'Supabase não disponível. Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY do projeto oficial de produção.'
    );
  }
  return supabase;
}

function reportSupabaseError(error) {
  lastConnectionError = error?.message || String(error || 'Erro desconhecido no Supabase');
}

async function pingSupabase() {
  if (!supabase) {
    return {
      configured: isSupabaseConfigured(),
      responding: false,
      mode: 'unavailable',
      error: lastConnectionError || 'Cliente Supabase não inicializado'
    };
  }

  const probeTables = ['appointments', 'patients', 'atendimentos'];
  let lastError = null;
  for (const table of probeTables) {
    const { error } = await supabase.from(table).select('id', { count: 'exact', head: true }).limit(1);
    if (!error) {
      lastError = null;
      break;
    }
    lastError = error;
  }
  if (lastError) {
    reportSupabaseError(lastError);
    return {
      configured: true,
      responding: false,
      mode: 'error',
      error: lastError.message
    };
  }

  lastConnectionError = null;
  return {
    configured: true,
    responding: true,
    mode: 'supabase',
    error: null
  };
}

function getSupabaseStatus() {
  return {
    configured: isSupabaseConfigured(),
    initialized,
    responding: Boolean(supabase && !lastConnectionError),
    mode: supabase && !lastConnectionError ? 'supabase' : 'unavailable',
    buckets: getSupabaseBuckets(),
    error: lastConnectionError,
    fallback_disabled: true
  };
}

module.exports = {
  getSupabaseBuckets,
  getSupabaseStatus,
  getSupabase,
  initSupabase,
  isInitialized: () => initialized,
  isSupabaseConfigured,
  pingSupabase,
  reportSupabaseError
};
