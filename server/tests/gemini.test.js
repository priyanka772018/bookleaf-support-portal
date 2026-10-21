import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Configure before the config module loads (each test file runs in its own process).
process.env.GEMINI_API_KEY = 'AIza-test-key';
process.env.GEMINI_MODEL = 'gemini-test-flash';
process.env.AI_MAX_RETRIES = '1';
const { callGemini, buildGeminiBody } = await import('../src/ai/gemini.js');
const { CLASSIFY_TOOL } = await import('../src/ai/prompts/classify.js');

const request = {
  system: [{ type: 'text', text: 'You are triage.', cache_control: { type: 'ephemeral' } }],
  user: '<ticket>No royalty for 6 months</ticket>',
  tool: CLASSIFY_TOOL,
  maxTokens: 200,
  temperature: 0,
};

let calls;
function mockFetch(responses) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const r = responses.shift();
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status ?? 200 });
  };
}
beforeEach(() => { calls = []; });

test('builds a forced function call with the key in a header, not the URL', async () => {
  mockFetch([{ body: {
    candidates: [{ content: { parts: [{ functionCall: { name: 'classify_ticket', args: { category: 'royalty_payments', priority: 'critical', confidence: 0.9, reasoning: 'r' } } }] } }],
    usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 40, thoughtsTokenCount: 10 },
  } }]);
  const { toolInput, usage } = await callGemini(request);
  assert.equal(toolInput.priority, 'critical');
  assert.deepEqual(usage, { input_tokens: 300, output_tokens: 50, cache_read_input_tokens: 0 });

  const { url, init } = calls[0];
  assert.match(url, /models\/gemini-test-flash:generateContent$/);
  assert.doesNotMatch(url, /AIza/);
  assert.equal(init.headers['x-goog-api-key'], 'AIza-test-key');
  const body = JSON.parse(init.body);
  assert.equal(body.toolConfig.functionCallingConfig.mode, 'ANY');
  assert.equal(body.tools[0].functionDeclarations[0].name, 'classify_ticket');
  assert.equal(body.systemInstruction.parts[0].text, 'You are triage.');
});

test('strips schema keys Gemini rejects', () => {
  const body = buildGeminiBody({ ...request, tool: { ...CLASSIFY_TOOL, input_schema: { ...CLASSIFY_TOOL.input_schema, additionalProperties: false } } });
  assert.equal(body.tools[0].functionDeclarations[0].parameters.additionalProperties, undefined);
});

test('accepts JSON text when the model skips the function call', async () => {
  mockFetch([{ body: { candidates: [{ content: { parts: [{ text: '```json\n{"category":"general_inquiry","priority":"low"}\n```' }] } }] } }]);
  const { toolInput } = await callGemini(request);
  assert.equal(toolInput.category, 'general_inquiry');
});

test('retries 429 then reports rate_limited (so the caller falls back)', async () => {
  mockFetch([{ status: 429, body: 'quota' }, { status: 429, body: 'quota' }]);
  await assert.rejects(callGemini(request), (err) => err.reason === 'rate_limited');
  assert.equal(calls.length, 2, 'one retry with AI_MAX_RETRIES=1');
});

test('bad key is reported as auth_error', async () => {
  mockFetch([{ status: 400, body: '{"error":{"message":"API key not valid"}}' }]);
  await assert.rejects(callGemini(request), (err) => err.reason === 'auth_error');
});
