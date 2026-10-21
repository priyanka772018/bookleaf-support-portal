import 'dotenv/config';

/**
 * Centralised, validated configuration. Every secret is read from the
 * environment here and nowhere else — nothing secret is ever sent to the client.
 */
function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const isTest = process.env.NODE_ENV === 'test';
const isProd = process.env.NODE_ENV === 'production';

export const config = {
  env: process.env.NODE_ENV || 'development',
  isTest,
  isProd,
  port: Number(process.env.PORT || 4000),

  databaseUrl: isTest
    ? required('TEST_DATABASE_URL', 'postgres://bookleaf:bookleaf@localhost:5432/bookleaf_test')
    : required('DATABASE_URL', isProd ? undefined : 'postgres://bookleaf:bookleaf@localhost:5432/bookleaf'),
  databaseSsl: process.env.DATABASE_SSL === 'true',

  jwtSecret: required('JWT_SECRET', isProd ? undefined : 'dev-only-insecure-secret-change-me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',

  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',

  ai: {
    // 'anthropic' in normal operation; 'disabled' forces the rule-based fallback
    // path; 'mock' is used by the test-suite.
    provider: process.env.AI_PROVIDER || (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'disabled'),
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.AI_MODEL || 'claude-haiku-5-5',
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || 15000),
    maxRetries: Number(process.env.AI_MAX_RETRIES || 2),
    // USD per million tokens — used only to estimate spend in the admin AI-usage panel.
    inputCostPerMTok: Number(process.env.AI_INPUT_COST_PER_MTOK || 0.1),
    outputCostPerMTok: Number(process.env.AI_OUTPUT_COST_PER_MTOK || 0.5),
    // After this many consecutive failures the circuit opens and we stop calling
    // the provider for `circuitCooldownMs`, using fallbacks instead.
    circuitFailureThreshold: Number(process.env.AI_CIRCUIT_THRESHOLD || 3),
    circuitCooldownMs: Number(process.env.AI_CIRCUIT_COOLDOWN_MS || 60000),
  },

  uploads: {
    dir: process.env.UPLOAD_DIR || 'uploads',
    maxBytes: Number(process.env.UPLOAD_MAX_BYTES || 5 * 1024 * 1024),
  },
};
