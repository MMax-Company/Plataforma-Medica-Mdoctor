const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const configuredLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const activeLevel = LEVELS[configuredLevel] ?? LEVELS.info;

function serializeError(error) {
  if (!error) return undefined;
  return {
    name: error.name,
    message: error.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : error.stack
  };
}

function write(level, message, meta = {}) {
  if ((LEVELS[level] ?? LEVELS.info) > activeLevel) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'mdoctor-backend',
    message,
    ...meta
  };

  if (entry.error instanceof Error) {
    entry.error = serializeError(entry.error);
  }

  const line = JSON.stringify(entry);
  if (level === 'error') return console.error(line);
  if (level === 'warn') return console.warn(line);
  return console.log(line);
}

module.exports = {
  debug: (message, meta) => write('debug', message, meta),
  error: (message, meta) => write('error', message, meta),
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta)
};
