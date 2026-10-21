/**
 * Orchestrates AI features on top of tickets:
 *  - background triage after ticket creation (never blocks the author)
 *  - cached drafts for admins
 *  - usage/cost reporting
 */
import { query } from '../db/pool.js';
import { config } from '../config/env.js';
import { notFound } from '../utils/errors.js';
import { classifyTicket } from '../ai/classifier.js';
import { generateDraft } from '../ai/drafter.js';
import { buildAccountFacts, bookFacts } from '../ai/accountFacts.js';
import { activeModel, aiEnabled, circuitState } from '../ai/provider.js';
import { getAuthor, getBooksRaw } from './bookService.js';
import { getTicketRow, getMessages } from './ticketService.js';
import { publish } from './events.js';

// Track in-flight background jobs so tests / graceful shutdown can await them.
const inFlight = new Set();
export function waitForBackgroundJobs() { return Promise.all([...inFlight]); }

function runInBackground(fn) {
  const p = Promise.resolve().then(fn).catch((err) => {
    if (!config.isTest) console.error('[ai:background]', err);
  }).finally(() => inFlight.delete(p));
  inFlight.add(p);
  return p;
}

/**
 * Classify a ticket with the LLM and store the result. Never overwrites a
 * category/priority an admin has already overridden.
 */
export async function triageTicket(ticketId) {
  const row = await getTicketRow(ticketId);
  if (!row) return null;

  // Small amount of book context helps (e.g. "book is still in production").
  let bookSummary = null;
  if (row.book_id) {
    const books = await getBooksRaw(row.author_id);
    const book = books.find((b) => b.id === row.book_id);
    if (book) bookSummary = bookFacts(book).slice(0, 3).join('; ');
  }

  const result = await classifyTicket({ ticketId, subject: row.subject, description: row.description, bookSummary });
  const aiStatus = result.source === 'ai' ? 'completed' : 'fallback';
  const reasoning = result.source === 'ai'
    ? result.reasoning
    : `Keyword fallback used (${result.failureReason}). Review the classification.`;

  const { rows: [updated] } = await query(
    `UPDATE tickets SET
       category = CASE WHEN category_source = 'admin' THEN category ELSE $2 END,
       category_source = CASE WHEN category_source = 'admin' THEN 'admin' ELSE $3 END,
       priority = CASE WHEN priority_source = 'admin' THEN priority ELSE $4 END,
       priority_source = CASE WHEN priority_source = 'admin' THEN 'admin' ELSE $3 END,
       ai_status = $5, ai_confidence = $6, ai_reasoning = $7
     WHERE id = $1 RETURNING id, author_id, status, category, priority`,
    [ticketId, result.category, result.source, result.priority, aiStatus, result.confidence, reasoning]);

  await query(`INSERT INTO ticket_events (ticket_id, type, to_value) VALUES ($1, $2, $3)`,
    [ticketId, result.source === 'ai' ? 'ai_classified' : 'ai_fallback', `${result.category} / ${result.priority}`]);
  publish('ticket.updated', { ticketId, authorId: updated.author_id, status: updated.status }, { toAuthor: false, toAdmins: true });
  return result;
}

export function triageInBackground(ticketId) {
  return runInBackground(() => triageTicket(ticketId));
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------
function toDraftView(d, { cached }) {
  return {
    id: d.id,
    content: d.content,
    checklist: d.admin_checklist ?? [],
    source: d.source,
    model: d.model,
    failureReason: d.failure_reason,
    createdAt: d.created_at,
    cached,
  };
}

/**
 * Returns the latest draft for the ticket's current conversation state,
 * generating one only if the thread has changed since the last draft (or
 * `force` is set). Re-opening a ticket therefore costs no tokens.
 * Template fallbacks are not treated as a valid cache so a later open can
 * upgrade to a real AI draft once the provider recovers.
 */
export async function getOrCreateDraft(ticketId, { force = false } = {}) {
  const row = await getTicketRow(ticketId);
  if (!row) throw notFound('Ticket');
  const messages = await getMessages(ticketId);

  if (!force) {
    const { rows: [cachedDraft] } = await query(
      `SELECT * FROM ai_drafts WHERE ticket_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1`, [ticketId]);
    if (cachedDraft && cachedDraft.message_count === messages.length && cachedDraft.source === 'ai') {
      return toDraftView(cachedDraft, { cached: true });
    }
  }

  const [author, books] = await Promise.all([getAuthor(row.author_id), getBooksRaw(row.author_id)]);
  const accountFacts = buildAccountFacts({ author, books, ticketBookId: row.book_id });
  const draft = await generateDraft({
    ticket: row,
    accountFacts,
    messages: messages.map((m) => ({ sender_role: m.senderRole, body: m.body, created_at: m.createdAt })),
    authorFirstName: author.name.split(' ')[0],
  });

  const { rows: [saved] } = await query(
    `INSERT INTO ai_drafts (ticket_id, content, admin_checklist, source, model, failure_reason, message_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [ticketId, draft.reply, JSON.stringify(draft.admin_checklist ?? []), draft.source,
      draft.source === 'ai' ? activeModel() : null, draft.failureReason ?? null, messages.length]);
  return toDraftView(saved, { cached: false });
}

// ---------------------------------------------------------------------------
// Usage & health
// ---------------------------------------------------------------------------
export function aiHealth() {
  return { enabled: aiEnabled(), provider: config.ai.provider, model: activeModel(), circuit: circuitState() };
}

export async function usageReport({ days = 30 } = {}) {
  const { rows } = await query(
    `SELECT purpose,
        count(*)::int AS calls,
        count(*) FILTER (WHERE status='success')::int AS succeeded,
        count(*) FILTER (WHERE status='error')::int AS failed,
        count(*) FILTER (WHERE status='skipped')::int AS skipped,
        COALESCE(sum(input_tokens),0)::int AS input_tokens,
        COALESCE(sum(output_tokens),0)::int AS output_tokens,
        COALESCE(sum(cache_read_tokens),0)::int AS cache_read_tokens,
        COALESCE(round(avg(latency_ms) FILTER (WHERE status='success')),0)::int AS avg_latency_ms
     FROM ai_calls WHERE created_at > now() - make_interval(days => $1)
     GROUP BY purpose ORDER BY purpose`, [days]);
  const { rows: [drafts] } = await query(
    `SELECT count(*)::int AS replies, count(*) FILTER (WHERE ai_assisted)::int AS ai_assisted
     FROM ticket_messages WHERE sender_role='admin' AND created_at > now() - make_interval(days => $1)`, [days]);
  const cost = (r) => (r.input_tokens * config.ai.inputCostPerMTok + r.output_tokens * config.ai.outputCostPerMTok) / 1e6;
  const byPurpose = rows.map((r) => ({ ...r, estimated_cost_usd: Number(cost(r).toFixed(5)) }));
  return {
    windowDays: days,
    model: activeModel(),
    byPurpose,
    totals: {
      calls: byPurpose.reduce((n, r) => n + r.calls, 0),
      estimatedCostUsd: Number(byPurpose.reduce((n, r) => n + r.estimated_cost_usd, 0).toFixed(5)),
    },
    replies: drafts,
    health: aiHealth(),
  };
}
