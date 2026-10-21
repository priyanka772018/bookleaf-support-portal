/**
 * Ticket triage: LLM classification with validated output, falling back to the
 * keyword classifier on any failure (disabled, outage, rate limit, bad output).
 */
import { z } from 'zod';
import { CATEGORY_KEYS, PRIORITIES } from '../config/constants.js';
import { callTool } from './provider.js';
import { CLASSIFY_SYSTEM, CLASSIFY_TOOL, buildClassifyUserMessage } from './prompts/classify.js';
import { classifyWithRules } from './ruleClassifier.js';

const resultSchema = z.object({
  category: z.enum(CATEGORY_KEYS),
  priority: z.enum(PRIORITIES),
  confidence: z.coerce.number().min(0).max(1).catch(0.5),
  reasoning: z.string().max(500).catch(''),
});

/**
 * @returns {Promise<{category, priority, confidence, reasoning, source: 'ai'|'rules', failureReason?}>}
 */
export async function classifyTicket({ ticketId, subject, description, bookSummary }) {
  const result = await callTool({
    purpose: 'classify',
    ticketId,
    // Static system prompt is cacheable across every classification call.
    system: [{ type: 'text', text: CLASSIFY_SYSTEM, cache_control: { type: 'ephemeral' } }],
    user: buildClassifyUserMessage({ subject, description, bookSummary }),
    tool: CLASSIFY_TOOL,
    maxTokens: 200,
  });

  if (result.ok) {
    const parsed = resultSchema.safeParse(result.toolInput);
    if (parsed.success) return { ...parsed.data, source: 'ai' };
    return { ...classifyWithRules({ subject, description }), source: 'rules', failureReason: 'invalid_ai_output' };
  }
  return { ...classifyWithRules({ subject, description }), source: 'rules', failureReason: result.reason };
}
