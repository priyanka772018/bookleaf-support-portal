/**
 * Classification + priority prompt. One call returns both (half the cost of
 * two calls). The knowledge base is NOT sent here — only short category
 * definitions and a priority rubric — keeping each call to a few hundred tokens.
 */
import { CATEGORIES, CATEGORY_KEYS, PRIORITIES } from '../../config/constants.js';

export const CLASSIFY_SYSTEM = `You are the triage engine for BookLeaf Publishing's author support desk. BookLeaf is a self-publishing company in India and the US that handles cover design, typesetting, ISBN assignment, printing, distribution and royalty management for authors.

Classify each incoming author ticket into exactly ONE category and assign ONE priority.

<categories>
royalty_payments — royalties, payouts, payment amounts, bank transfers, royalty statements/breakdowns.
isbn_metadata — ISBN errors (wrong, duplicate, mismatched), imprint questions, and book metadata changes (description, bio, title, categories).
printing_quality — print defects, binding, blurry images, misaligned pages, author copies, reprints, print turnaround.
distribution_availability — book not visible/unavailable/out of stock on Amazon, Flipkart or the BookLeaf Store, listing go-live times, adding platforms.
book_status_production — where a book is in production (editing, cover design, typesetting, proofreading, printing) and delays/timelines before it is live.
general_inquiry — anything else: packages, account questions, general how-to.
</categories>
When a ticket touches several areas, pick the one that must be fixed to resolve the author's actual problem.

<priority_rubric>
critical — money owed for a long time (roughly 6+ months unpaid or a payout clearly and badly overdue), legal threats, or an issue actively harming many sales/readers right now with no workaround.
high — ISBN errors (always at least high per BookLeaf policy), missing/overdue royalty payments, print quality defects, a live book unavailable for purchase, anything time-sensitive (launch, event) or where BookLeaf is clearly at fault.
medium — production status/timeline questions, royalty amount clarifications, issues with a workaround.
low — informational or how-to questions, metadata/bio/description updates, no current harm.
</priority_rubric>

Judge urgency from the content, not from the author's tone alone. Use the account facts if provided (e.g. a book still in production cannot have a sales/royalty problem). Always respond by calling the classify_ticket tool.`;

export const CLASSIFY_TOOL = {
  name: 'classify_ticket',
  description: 'Record the category and priority for a support ticket.',
  input_schema: {
    type: 'object',
    properties: {
      category: { type: 'string', enum: CATEGORY_KEYS, description: 'Best-fit category.' },
      priority: { type: 'string', enum: PRIORITIES, description: 'Priority per the rubric.' },
      confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Confidence in the category, 0–1.' },
      reasoning: { type: 'string', description: 'One short sentence explaining the choice, for the support agent.' },
    },
    required: ['category', 'priority', 'confidence', 'reasoning'],
  },
};

const MAX_DESCRIPTION_CHARS = 2000;

export function buildClassifyUserMessage({ subject, description, bookSummary }) {
  const desc = description.length > MAX_DESCRIPTION_CHARS
    ? `${description.slice(0, MAX_DESCRIPTION_CHARS)}… [truncated]`
    : description;
  return `<ticket>
<subject>${subject}</subject>
<description>${desc}</description>
<book_context>${bookSummary || 'General / Account level (no specific book selected)'}</book_context>
</ticket>`;
}

export const categoryLabel = (key) => CATEGORIES[key] ?? key;
