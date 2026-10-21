/**
 * Thin wrapper around the LLM provider (Anthropic Claude by default, Google
 * Gemini optional — see gemini.js). Responsibilities:
 *  - the ONLY place the API key is used (server-side, from env)
 *  - timeouts + bounded retries (SDK retries 429/5xx with exponential backoff)
 *  - a circuit breaker: after N consecutive failures we stop calling the API for
 *    a cooldown period and let callers use their fallbacks immediately, instead
 *    of making every ticket wait for a timeout during an outage
 *  - logging every call (tokens, latency, errors) to ai_calls for cost tracking
 *
 * Callers get back `{ ok: true, toolInput, usage }` or `{ ok: false, reason }`
 * and never have to catch provider errors themselves.
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/env.js';
import { query } from '../db/pool.js';
import { callGemini, GeminiError } from './gemini.js';

/** Model id of the active provider (for logging and the usage page). */
export function activeModel() {
  return config.ai.provider === 'gemini' ? config.ai.geminiModel : config.ai.model;
}

let client = null;
function getClient() {
  if (!client) {
    client = new Anthropic({
      apiKey: config.ai.apiKey,
      timeout: config.ai.timeoutMs,
      maxRetries: config.ai.maxRetries,
    });
  }
  return client;
}

// ---- circuit breaker -------------------------------------------------------
const breaker = { failures: 0, openUntil: 0 };
export function circuitState() {
  return { open: Date.now() < breaker.openUntil, consecutiveFailures: breaker.failures, openUntil: breaker.openUntil || null };
}
function recordSuccess() { breaker.failures = 0; breaker.openUntil = 0; }
function recordFailure() {
  breaker.failures += 1;
  if (breaker.failures >= config.ai.circuitFailureThreshold) {
    breaker.openUntil = Date.now() + config.ai.circuitCooldownMs;
  }
}
export function resetCircuit() { breaker.failures = 0; breaker.openUntil = 0; }

// ---- mock provider (tests / offline demos) ---------------------------------
// Tests can register a handler: setMockHandler(({ purpose, request }) => toolInput | throw)
let mockHandler = null;
export function setMockHandler(fn) { mockHandler = fn; }

export function aiEnabled() {
  if (config.ai.provider === 'mock') return true;
  if (config.ai.provider === 'anthropic') return Boolean(config.ai.apiKey);
  if (config.ai.provider === 'gemini') return Boolean(config.ai.geminiApiKey);
  return false;
}

async function logCall({ ticketId, purpose, status, usage = {}, latencyMs, error }) {
  try {
    await query(
      `INSERT INTO ai_calls (ticket_id, purpose, model, status, input_tokens, output_tokens,
         cache_read_tokens, latency_ms, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [ticketId ?? null, purpose, activeModel(), status, usage.input_tokens ?? 0,
        usage.output_tokens ?? 0, usage.cache_read_input_tokens ?? 0, latencyMs ?? null,
        error ? String(error).slice(0, 500) : null],
    );
  } catch (err) {
    // Logging must never break the request path.
    if (!config.isTest) console.warn('ai_calls log failed:', err.message);
  }
}

function describeError(err) {
  if (err instanceof GeminiError) return err.reason;
  if (err instanceof Anthropic.RateLimitError) return 'rate_limited';
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'timeout';
  if (err instanceof Anthropic.APIConnectionError) return 'connection_error';
  if (err instanceof Anthropic.AuthenticationError) return 'auth_error';
  if (err instanceof Anthropic.APIError) return `api_error_${err.status ?? 'unknown'}`;
  return err?.message || 'unknown_error';
}

/**
 * Calls the model with a single forced tool so the output is structured JSON.
 * @param {object} p
 * @param {'classify'|'draft'} p.purpose
 * @param {number|null} p.ticketId
 * @param {Array} p.system      system blocks (static parts are marked cacheable)
 * @param {string} p.user       user message content
 * @param {object} p.tool       { name, description, input_schema }
 * @param {number} p.maxTokens
 */
export async function callTool({ purpose, ticketId, system, user, tool, maxTokens, temperature = 0 }) {
  if (!aiEnabled()) {
    return { ok: false, reason: 'ai_disabled' };
  }
  if (circuitState().open) {
    await logCall({ ticketId, purpose, status: 'skipped', error: 'circuit_open' });
    return { ok: false, reason: 'circuit_open' };
  }

  const request = {
    model: config.ai.model,
    max_tokens: maxTokens,
    temperature,
    system,
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name },
    messages: [{ role: 'user', content: user }],
  };

  const started = Date.now();
  try {
    let toolInput;
    let usage = {};
    if (config.ai.provider === 'mock') {
      if (!mockHandler) throw new Error('mock handler not configured');
      toolInput = await mockHandler({ purpose, request });
      usage = { input_tokens: Math.ceil(JSON.stringify(request).length / 4), output_tokens: 50 };
    } else if (config.ai.provider === 'gemini') {
      ({ toolInput, usage } = await callGemini({ system, user, tool, maxTokens, temperature }));
    } else {
      const response = await getClient().messages.create(request);
      usage = response.usage ?? {};
      const block = response.content.find((b) => b.type === 'tool_use' && b.name === tool.name);
      if (!block) throw new Error(`model did not call ${tool.name} (stop_reason=${response.stop_reason})`);
      toolInput = block.input;
    }
    recordSuccess();
    await logCall({ ticketId, purpose, status: 'success', usage, latencyMs: Date.now() - started });
    return { ok: true, toolInput, usage };
  } catch (err) {
    recordFailure();
    const reason = describeError(err);
    await logCall({ ticketId, purpose, status: 'error', latencyMs: Date.now() - started, error: reason });
    if (!config.isTest) console.warn(`[ai:${purpose}] ticket=${ticketId} failed: ${reason}`);
    return { ok: false, reason };
  }
}
