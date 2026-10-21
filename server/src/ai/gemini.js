/**
 * Google Gemini adapter. Translates our provider-neutral request (system blocks,
 * one user message, one forced tool) into a Gemini `generateContent` call with
 * forced function calling, and normalises the result back to
 * `{ toolInput, usage }` in the same shape the Anthropic path returns.
 *
 * Uses plain fetch (no extra dependency). Retries 429/5xx with exponential
 * backoff, mirroring what the Anthropic SDK does for us.
 */
import { config } from '../config/env.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason; // rate_limited | timeout | auth_error | api_error_<status> | connection_error | no_tool_call
  }
}

// Gemini's function schemas accept an OpenAPI subset; drop keys it rejects.
function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'additionalProperties' || k === '$schema') continue;
    out[k] = typeof v === 'object' ? toGeminiSchema(v) : v;
  }
  return out;
}

export function buildGeminiBody({ system, user, tool, maxTokens, temperature }) {
  return {
    systemInstruction: { parts: system.map((b) => ({ text: b.text })) },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    tools: [{ functionDeclarations: [{ name: tool.name, description: tool.description, parameters: toGeminiSchema(tool.input_schema) }] }],
    toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [tool.name] } },
    generationConfig: {
      temperature,
      // Newer Gemini models may spend output tokens on internal reasoning before
      // the function call, so allow headroom above our Anthropic budget.
      maxOutputTokens: Math.max(maxTokens * 4, 1024),
    },
  };
}

function parseResponse(data, toolName) {
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const call = parts.find((p) => p.functionCall?.name === toolName)?.functionCall;
  if (call) return call.args ?? {};
  // Some models answer with JSON text despite forced calling — accept it if it parses.
  const text = parts.map((p) => p.text ?? '').join('').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  if (text.startsWith('{')) {
    try { return JSON.parse(text); } catch { /* fall through */ }
  }
  const reason = data?.candidates?.[0]?.finishReason ?? data?.promptFeedback?.blockReason ?? 'unknown';
  throw new GeminiError('no_tool_call', `Gemini did not call ${toolName} (finishReason=${reason})`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function callGemini(request) {
  const url = `${BASE_URL}/models/${encodeURIComponent(config.ai.geminiModel)}:generateContent`;
  const body = JSON.stringify(buildGeminiBody(request));

  for (let attempt = 0; ; attempt += 1) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        // Key in a header, not the URL, so it never appears in logs.
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.ai.geminiApiKey },
        body,
        signal: AbortSignal.timeout(config.ai.timeoutMs),
      });
    } catch (err) {
      const reason = err.name === 'TimeoutError' ? 'timeout' : 'connection_error';
      if (attempt < config.ai.maxRetries) { await sleep(500 * 2 ** attempt); continue; }
      throw new GeminiError(reason, err.message);
    }

    if (res.ok) {
      const data = await res.json();
      const u = data.usageMetadata ?? {};
      return {
        toolInput: parseResponse(data, request.tool.name),
        usage: {
          input_tokens: u.promptTokenCount ?? 0,
          // Count reasoning tokens as output — they are billed as output.
          output_tokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
          cache_read_input_tokens: u.cachedContentTokenCount ?? 0,
        },
      };
    }

    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < config.ai.maxRetries) { await sleep(1000 * 2 ** attempt); continue; }
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    if (res.status === 429) throw new GeminiError('rate_limited', detail);
    if (res.status === 401 || res.status === 403) throw new GeminiError('auth_error', detail);
    if (res.status === 400 && /API key/i.test(detail)) throw new GeminiError('auth_error', detail);
    throw new GeminiError(`api_error_${res.status}`, detail);
  }
}
