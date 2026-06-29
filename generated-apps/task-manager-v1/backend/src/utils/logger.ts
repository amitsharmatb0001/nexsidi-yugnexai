const isDev = process.env.NODE_ENV !== 'production';

export const logger = {
  info:  (...a: unknown[]) => isDev && console.log('[INFO]',  ...a),
  debug: (...a: unknown[]) => isDev && console.log('[DEBUG]', ...a),
  warn:  (...a: unknown[]) => console.warn('[WARN]',  ...a),
  error: (...a: unknown[]) => console.error('[ERROR]', ...a),
};
