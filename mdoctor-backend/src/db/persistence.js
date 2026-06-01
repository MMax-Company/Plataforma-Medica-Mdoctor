const { getSupabase, isSupabaseConfigured } = require('../config/supabase');

class PersistenceError extends Error {
  constructor(message, context = {}, cause = null) {
    super(message);
    this.name = 'PersistenceError';
    this.code = 'PERSISTENCE_REQUIRED';
    this.context = context;
    this.cause = cause;
  }
}

function isPersistenceRequired() {
  if (process.env.SUPABASE_PERSISTENCE_OPTIONAL === 'true') return false;
  if (process.env.SUPABASE_REQUIRED === 'false') return false;
  return true;
}

function requireSupabaseClient(context = 'database') {
  if (!isSupabaseConfigured()) {
    throw new PersistenceError(`Supabase obrigatório (${context}): configure SUPABASE_URL e service role key`, {
      context
    });
  }
  try {
    return getSupabase();
  } catch (error) {
    throw new PersistenceError(`Supabase não inicializado (${context})`, { context }, error);
  }
}

function throwOnDbError(error, context, extra = {}) {
  if (!error) return;
  throw new PersistenceError(error.message || 'Erro de persistência Supabase', { context, ...extra }, error);
}

async function dbQuery(context, runner) {
  const supabase = requireSupabaseClient(context);
  const result = await runner(supabase);
  if (result?.error) {
    throwOnDbError(result.error, context, result.meta || {});
  }
  return result?.data;
}

module.exports = {
  PersistenceError,
  dbQuery,
  isPersistenceRequired,
  requireSupabaseClient,
  throwOnDbError
};
