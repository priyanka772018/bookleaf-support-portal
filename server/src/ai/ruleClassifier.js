/**
 * Deterministic keyword classifier used
 *   1. instantly at ticket creation (so the queue never shows an unclassified ticket), and
 *   2. as the fallback whenever the LLM is disabled, down, rate-limited or returns junk.
 *
 * It is intentionally simple and transparent; the LLM result replaces it when available.
 */

const CATEGORY_KEYWORDS = {
  royalty_payments: ['royalt', 'payment', 'payout', 'paid', 'money', 'bank', 'earning', 'amount', '₹', 'rs.', 'inr', 'statement', 'transfer', 'compensation'],
  isbn_metadata: ['isbn', 'metadata', 'barcode', 'imprint', 'wrong book', 'duplicate', 'description', 'author bio', 'bio', 'title change', 'listing details', 'category on amazon'],
  printing_quality: ['print', 'blurry', 'misalign', 'binding', 'misprint', 'quality', 'defect', 'smudge', 'colour', 'color', 'torn', 'pages missing', 'author copies', 'reprint', 'cover faded'],
  distribution_availability: ['unavailable', 'out of stock', 'not available', 'amazon', 'flipkart', 'listing', 'not showing', 'cannot find', "can't find", 'distribution', 'buy link', 'available on', 'stock'],
  book_status_production: ['typesetting', 'cover design', 'proofread', 'production', 'stage', 'when will', 'delay', 'status', 'still in', 'editing', 'manuscript', 'proof', 'timeline', 'launch date'],
};

const CRITICAL_SIGNALS = [/\b(6|six|7|seven|8|eight|9|nine|10|ten|11|twelve|12)\s+months?\b/i, /\bover a year\b|\b1 year\b|\bone year\b/i, /\blegal\b|\blawyer\b|\bconsumer court\b|\bfraud\b|\bscam\b/i];
const HIGH_SIGNALS = [/\bisbn\b.*\b(wrong|different|duplicate|mismatch|incorrect|error)\b|\b(wrong|different|duplicate|mismatch|incorrect)\b.*\bisbn\b/i,
  /\bnot received\b|\bhaven'?t received\b|\bnever received\b|\bno royalt/i, /\bmisprint|blurry|misalign|defect|binding/i,
  /\bunavailable\b|\bout of stock\b/i, /\burgent\b|\basap\b|\bimmediately\b|\blaunch\b/i];
const LOW_SIGNALS = [/\bhow (do|can) i\b|\bcan i\b|\bis it possible\b|\bjust wondering\b|\bquick question\b/i, /\bbio\b|\bdescription\b|\bprofile\b/i];

export function classifyWithRules({ subject = '', description = '' }) {
  const text = `${subject}\n${description}`.toLowerCase();

  let best = 'general_inquiry';
  let bestScore = 0;
  for (const [category, words] of Object.entries(CATEGORY_KEYWORDS)) {
    const score = words.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);
    if (score > bestScore) { best = category; bestScore = score; }
  }
  // ISBN mentions dominate — an ISBN error is always treated as ISBN even if "Amazon" also appears.
  if (/\bisbn\b/i.test(text) && best !== 'isbn_metadata') best = 'isbn_metadata';

  let priority = 'medium';
  if (CRITICAL_SIGNALS.some((re) => re.test(text))) priority = 'critical';
  else if (HIGH_SIGNALS.some((re) => re.test(text)) || best === 'isbn_metadata' && /\b(wrong|different|duplicate|mismatch)\b/i.test(text)) priority = 'high';
  else if (LOW_SIGNALS.some((re) => re.test(text)) || best === 'general_inquiry') priority = 'low';

  return {
    category: best,
    priority,
    confidence: bestScore >= 2 ? 0.6 : 0.35,
    reasoning: 'Keyword-based fallback classification (AI unavailable or pending).',
  };
}
