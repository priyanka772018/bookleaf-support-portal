/**
 * Draft generation: LLM draft grounded in the category's knowledge-base
 * sections + computed account facts, with a policy-based template fallback so
 * agents always get a useful starting point even when the AI is unavailable.
 */
import { z } from 'zod';
import { callTool } from './provider.js';
import { DRAFT_SYSTEM, DRAFT_TOOL, buildDraftUserMessage } from './prompts/draft.js';

const draftSchema = z.object({
  reply: z.string().min(20),
  admin_checklist: z.array(z.string()).max(6).catch([]),
});

const TEMPLATE_BODIES = {
  royalty_payments: 'Royalties at BookLeaf are calculated quarterly and paid within 45 days of each quarter ending, by bank transfer to the account linked in your dashboard (minimum payout ₹1,000; smaller amounts roll over to the next quarter). Our team is reviewing your royalty records now and will get back to you within 48 hours with a full breakdown and the exact payout date.',
  isbn_metadata: 'An ISBN or metadata error is a serious issue and we are treating it as high priority. I have escalated this to our production team, and we will get back to you within 48 hours with a resolution.',
  printing_quality: 'We are sorry the copies did not meet the standard you should expect from us. Could you reply with a few photos of the affected pages? Once verified, we will arrange a free reprint, which typically takes 5–7 business days.',
  distribution_availability: 'When a published book shows as unavailable, it is usually a stock sync issue with the platform. We are triggering a re-sync with our distribution team, and your book should be available again within 24–48 hours.',
  book_status_production: 'We are checking the current status of your book with our production team and will share a specific, updated timeline within 48 hours.',
  general_inquiry: 'Our team is looking into this and will get back to you within 48 hours with the details.',
};

/** Policy-based fallback used when the AI is unavailable. Clearly marked for the agent. */
export function templateDraft({ ticket, authorFirstName }) {
  const body = TEMPLATE_BODIES[ticket.category] ?? TEMPLATE_BODIES.general_inquiry;
  return {
    reply: `Hi ${authorFirstName},\n\nThank you for reaching out about "${ticket.subject}". I understand how important this is to you.\n\n${body}\n\nWarm regards,\nBookLeaf Author Support`,
    admin_checklist: ['AI draft unavailable — this is a policy template. Personalise it with the author\'s specific figures before sending.'],
  };
}

/**
 * @returns {Promise<{reply, admin_checklist, source: 'ai'|'template', failureReason?}>}
 */
export async function generateDraft({ ticket, accountFacts, messages, authorFirstName }) {
  const result = await callTool({
    purpose: 'draft',
    ticketId: ticket.id,
    system: [{ type: 'text', text: DRAFT_SYSTEM, cache_control: { type: 'ephemeral' } }],
    user: buildDraftUserMessage({ ticket, accountFacts, messages, authorFirstName }),
    tool: DRAFT_TOOL,
    maxTokens: 700,
    temperature: 0.3,
  });
  if (result.ok) {
    const parsed = draftSchema.safeParse(result.toolInput);
    if (parsed.success) return { ...parsed.data, source: 'ai' };
    return { ...templateDraft({ ticket, authorFirstName }), source: 'template', failureReason: 'invalid_ai_output' };
  }
  return { ...templateDraft({ ticket, authorFirstName }), source: 'template', failureReason: result.reason };
}
