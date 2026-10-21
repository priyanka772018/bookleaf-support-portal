/**
 * Ticket domain logic + data access. Routes stay thin; every rule about who can
 * see/do what to a ticket lives here.
 */
import { query, withTransaction } from '../db/pool.js';
import { CATEGORIES } from '../config/constants.js';
import { notFound, badRequest, conflict } from '../utils/errors.js';
import { classifyWithRules } from '../ai/ruleClassifier.js';
import { publish } from './events.js';

/** First-response targets (hours) used to flag overdue tickets in the queue. */
export const SLA_HOURS = { critical: 4, high: 24, medium: 48, low: 72 };

const PRIORITY_RANK_SQL = `CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`;

export const ticketRef = (id) => `BL-${String(id).padStart(5, '0')}`;

// ---------------------------------------------------------------------------
// Serialisers — the author view deliberately omits internal fields
// (priority, AI reasoning, assignee, internal notes).
// ---------------------------------------------------------------------------
function baseTicket(row) {
  return {
    id: row.id,
    ref: ticketRef(row.id),
    subject: row.subject,
    description: row.description,
    status: row.status,
    category: row.category,
    categoryLabel: row.category ? CATEGORIES[row.category] : null,
    book: row.book_id ? { id: row.book_id, title: row.book_title } : null,
    attachment: row.attachment_name ? { name: row.attachment_name, mime: row.attachment_mime } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}

function toAuthorView(row) {
  return {
    ...baseTicket(row),
    lastMessageAt: row.last_message_at ?? row.created_at,
    awaitingAuthor: row.last_sender_role === 'admin',
    replyCount: row.admin_reply_count ?? 0,
  };
}

function toAdminView(row) {
  const ageHours = (Date.now() - new Date(row.created_at).getTime()) / 36e5;
  const slaHours = SLA_HOURS[row.priority] ?? 72;
  const isOpen = ['open', 'in_progress'].includes(row.status);
  return {
    ...baseTicket(row),
    author: { id: row.author_id, name: row.author_name, email: row.author_email },
    priority: row.priority,
    categorySource: row.category_source,
    prioritySource: row.priority_source,
    ai: { status: row.ai_status, confidence: row.ai_confidence, reasoning: row.ai_reasoning },
    assignee: row.assigned_to ? { id: row.assigned_to, name: row.assignee_name } : null,
    firstResponseAt: row.first_response_at,
    lastMessageAt: row.last_message_at ?? row.created_at,
    awaitingResponse: isOpen && row.last_sender_role !== 'admin',
    sla: {
      targetHours: slaHours,
      breached: isOpen && !row.first_response_at && ageHours > slaHours,
    },
    ageHours: Math.round(ageHours * 10) / 10,
  };
}

const TICKET_SELECT = `
  SELECT t.*, b.title AS book_title, a.name AS author_name, a.email AS author_email,
         u.name AS assignee_name,
         lm.created_at AS last_message_at, lm.sender_role AS last_sender_role,
         (SELECT count(*)::int FROM ticket_messages m WHERE m.ticket_id = t.id AND m.sender_role = 'admin') AS admin_reply_count
  FROM tickets t
  JOIN authors a ON a.id = t.author_id
  LEFT JOIN books b ON b.id = t.book_id
  LEFT JOIN users u ON u.id = t.assigned_to
  LEFT JOIN LATERAL (
    SELECT created_at, sender_role FROM ticket_messages m
    WHERE m.ticket_id = t.id ORDER BY created_at DESC, id DESC LIMIT 1
  ) lm ON true`;

async function getTicketRow(id) {
  const { rows } = await query(`${TICKET_SELECT} WHERE t.id = $1`, [id]);
  return rows[0] ?? null;
}

async function getMessages(ticketId) {
  const { rows } = await query(
    `SELECT m.id, m.sender_role, m.body, m.ai_assisted, m.created_at, u.name AS sender_name
     FROM ticket_messages m LEFT JOIN users u ON u.id = m.sender_id
     WHERE m.ticket_id = $1 ORDER BY m.created_at, m.id`, [ticketId]);
  return rows.map((m) => ({
    id: m.id,
    senderRole: m.sender_role,
    // Authors see replies from "BookLeaf Support" plus the agent's first name.
    senderName: m.sender_name,
    body: m.body,
    aiAssisted: m.ai_assisted,
    createdAt: m.created_at,
  }));
}

function emitTicketUpdate(row, type = 'ticket.updated', audience) {
  publish(type, { ticketId: row.id, authorId: row.author_id, status: row.status }, audience);
}

// ---------------------------------------------------------------------------
// Author operations
// ---------------------------------------------------------------------------
export async function createTicket({ user, bookId, subject, description, attachment }) {
  if (bookId) {
    const { rows } = await query('SELECT id FROM books WHERE id = $1 AND author_id = $2', [bookId, user.authorId]);
    if (!rows.length) throw badRequest('Validation failed', [{ field: 'bookId', message: 'Select one of your own books or General / Account level' }]);
  }
  // Instant keyword triage so the queue is never unclassified; AI refines it async.
  const rules = classifyWithRules({ subject, description });

  const ticketId = await withTransaction(async (client) => {
    const { rows: [t] } = await client.query(
      `INSERT INTO tickets (author_id, book_id, subject, description, category, category_source,
         priority, priority_source, ai_status, ai_confidence, ai_reasoning,
         attachment_name, attachment_path, attachment_mime)
       VALUES ($1,$2,$3,$4,$5,'rules',$6,'rules','pending',$7,$8,$9,$10,$11) RETURNING id`,
      [user.authorId, bookId || null, subject, description, rules.category, rules.priority,
        rules.confidence, rules.reasoning, attachment?.originalname ?? null,
        attachment?.filename ?? null, attachment?.mimetype ?? null],
    );
    await client.query(
      `INSERT INTO ticket_messages (ticket_id, sender_id, sender_role, body) VALUES ($1,$2,'author',$3)`,
      [t.id, user.id, description]);
    await client.query(
      `INSERT INTO ticket_events (ticket_id, actor_id, type, to_value) VALUES ($1,$2,'created','open')`,
      [t.id, user.id]);
    return t.id;
  });

  const row = await getTicketRow(ticketId);
  emitTicketUpdate(row, 'ticket.created');
  return { row, view: toAuthorView(row) };
}

export async function listAuthorTickets(user) {
  const { rows } = await query(`${TICKET_SELECT} WHERE t.author_id = $1 ORDER BY COALESCE(lm.created_at, t.created_at) DESC`, [user.authorId]);
  return rows.map(toAuthorView);
}

/** Returns 404 (not 403) for other authors' tickets so ids can't be probed. */
export async function getTicketForAuthor(user, id) {
  const row = await getTicketRow(id);
  if (!row || row.author_id !== user.authorId) throw notFound('Ticket');
  return { ...toAuthorView(row), messages: await getMessages(id) };
}

export async function addAuthorMessage(user, id, body) {
  const row = await getTicketRow(id);
  if (!row || row.author_id !== user.authorId) throw notFound('Ticket');
  if (row.status === 'closed') throw conflict('This ticket is closed. Please raise a new ticket.');

  await withTransaction(async (client) => {
    await client.query(`INSERT INTO ticket_messages (ticket_id, sender_id, sender_role, body) VALUES ($1,$2,'author',$3)`, [id, user.id, body]);
    // A reply on a resolved ticket re-opens it.
    if (row.status === 'resolved') {
      await client.query(`UPDATE tickets SET status='open', resolved_at=NULL, updated_at=now() WHERE id=$1`, [id]);
      await client.query(`INSERT INTO ticket_events (ticket_id, actor_id, type, from_value, to_value) VALUES ($1,$2,'status_changed','resolved','open')`, [id, user.id]);
    } else {
      await client.query('UPDATE tickets SET updated_at=now() WHERE id=$1', [id]);
    }
  });
  const updated = await getTicketRow(id);
  emitTicketUpdate(updated, 'ticket.message');
  return getTicketForAuthor(user, id);
}

export async function getAttachment(user, id) {
  const row = await getTicketRow(id);
  if (!row || (user.role === 'author' && row.author_id !== user.authorId)) throw notFound('Ticket');
  if (!row.attachment_path) throw notFound('Attachment');
  return { path: row.attachment_path, name: row.attachment_name, mime: row.attachment_mime };
}

// ---------------------------------------------------------------------------
// Admin operations
// ---------------------------------------------------------------------------
const SORTS = {
  urgency: `${PRIORITY_RANK_SQL}, t.created_at ASC`,
  oldest: 't.created_at ASC',
  newest: 't.created_at DESC',
  updated: 't.updated_at DESC',
};

export async function listAdminTickets(filters, user) {
  const where = [];
  const params = [];
  const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };

  if (filters.status?.length) add('t.status = ANY(?)', filters.status);
  if (filters.category?.length) add('t.category = ANY(?)', filters.category);
  if (filters.priority?.length) add('t.priority = ANY(?)', filters.priority);
  if (filters.from) add('t.created_at >= ?', filters.from);
  if (filters.to) add(`t.created_at < (?::date + interval '1 day')`, filters.to);
  if (filters.assignee === 'me') add('t.assigned_to = ?', user.id);
  if (filters.assignee === 'unassigned') where.push('t.assigned_to IS NULL');
  if (filters.q) {
    // Matches subject, author, book title, or a ticket ref like "BL-00012" / "12".
    params.push(`%${filters.q}%`, filters.q.toUpperCase().replace(/^BL-?/, '').replace(/^0+/, ''));
    const like = `$${params.length - 1}`;
    const ref = `$${params.length}`;
    where.push(`(t.subject ILIKE ${like} OR a.name ILIKE ${like} OR b.title ILIKE ${like} OR t.id::text = ${ref})`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // Unresolved tickets always float above resolved/closed ones in urgency mode.
  const order = filters.sort === 'urgency'
    ? `CASE WHEN t.status IN ('open','in_progress') THEN 0 ELSE 1 END, ${SORTS.urgency}`
    : SORTS[filters.sort];

  const countRes = await query(`SELECT count(*)::int AS total FROM tickets t JOIN authors a ON a.id=t.author_id LEFT JOIN books b ON b.id=t.book_id ${whereSql}`, params);
  const { rows } = await query(`${TICKET_SELECT} ${whereSql} ORDER BY ${order} LIMIT ${filters.limit} OFFSET ${filters.offset}`, params);
  return { total: countRes.rows[0].total, items: rows.map(toAdminView) };
}

export async function queueStats() {
  const { rows: [s] } = await query(`
    SELECT
      count(*) FILTER (WHERE status IN ('open','in_progress'))::int AS unresolved,
      count(*) FILTER (WHERE status = 'open')::int AS open,
      count(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
      count(*) FILTER (WHERE status IN ('open','in_progress') AND priority = 'critical')::int AS critical,
      count(*) FILTER (WHERE status IN ('open','in_progress') AND priority = 'high')::int AS high,
      count(*) FILTER (WHERE status IN ('open','in_progress') AND assigned_to IS NULL)::int AS unassigned,
      count(*) FILTER (WHERE status IN ('open','in_progress') AND first_response_at IS NULL AND created_at < now() - make_interval(hours =>
        CASE priority WHEN 'critical' THEN ${SLA_HOURS.critical} WHEN 'high' THEN ${SLA_HOURS.high} WHEN 'medium' THEN ${SLA_HOURS.medium} ELSE ${SLA_HOURS.low} END))::int AS sla_breached,
      count(*) FILTER (WHERE status = 'resolved' AND resolved_at > now() - interval '7 days')::int AS resolved_7d
    FROM tickets`);
  return s;
}

export async function getTicketForAdmin(id) {
  const row = await getTicketRow(id);
  if (!row) throw notFound('Ticket');
  const [messages, notes, events] = await Promise.all([
    getMessages(id),
    query(`SELECT n.id, n.body, n.created_at, u.name AS admin_name FROM internal_notes n
           LEFT JOIN users u ON u.id = n.admin_id WHERE n.ticket_id=$1 ORDER BY n.created_at`, [id]),
    query(`SELECT e.id, e.type, e.from_value, e.to_value, e.created_at, u.name AS actor_name FROM ticket_events e
           LEFT JOIN users u ON u.id = e.actor_id WHERE e.ticket_id=$1 ORDER BY e.created_at, e.id`, [id]),
  ]);
  return {
    ...toAdminView(row),
    messages,
    notes: notes.rows.map((n) => ({ id: n.id, body: n.body, adminName: n.admin_name, createdAt: n.created_at })),
    events: events.rows.map((e) => ({ id: e.id, type: e.type, from: e.from_value, to: e.to_value, actorName: e.actor_name, createdAt: e.created_at })),
  };
}

/**
 * Partial update: status, category, priority, assigneeId. Category/priority
 * changes mark the source as 'admin' so the AI never overwrites a human override.
 */
export async function updateTicket(user, id, changes) {
  const row = await getTicketRow(id);
  if (!row) throw notFound('Ticket');

  let assigneeName = null;
  if (changes.assigneeId !== undefined && changes.assigneeId !== null) {
    const { rows } = await query(`SELECT id, name FROM users WHERE id=$1 AND role='admin'`, [changes.assigneeId]);
    if (!rows.length) throw badRequest('Validation failed', [{ field: 'assigneeId', message: 'Assignee must be an admin user' }]);
    assigneeName = rows[0].name;
  }

  await withTransaction(async (client) => {
    const sets = [];
    const params = [];
    const set = (sql, value) => { params.push(value); sets.push(sql.replace('?', `$${params.length}`)); };
    const event = (type, from, to) => client.query(
      'INSERT INTO ticket_events (ticket_id, actor_id, type, from_value, to_value) VALUES ($1,$2,$3,$4,$5)',
      [id, user.id, type, from == null ? null : String(from), to == null ? null : String(to)]);

    if (changes.status && changes.status !== row.status) {
      set('status = ?', changes.status);
      if (changes.status === 'resolved' || changes.status === 'closed') sets.push('resolved_at = COALESCE(resolved_at, now())');
      else sets.push('resolved_at = NULL');
      await event('status_changed', row.status, changes.status);
    }
    if (changes.category && (changes.category !== row.category || row.category_source !== 'admin')) {
      set('category = ?', changes.category);
      sets.push(`category_source = 'admin'`);
      await event('category_overridden', row.category, changes.category);
    }
    if (changes.priority && (changes.priority !== row.priority || row.priority_source !== 'admin')) {
      set('priority = ?', changes.priority);
      sets.push(`priority_source = 'admin'`);
      await event('priority_overridden', row.priority, changes.priority);
    }
    if (changes.assigneeId !== undefined && changes.assigneeId !== row.assigned_to) {
      set('assigned_to = ?', changes.assigneeId);
      await event('assigned', row.assignee_name, assigneeName ?? 'unassigned');
    }
    if (!sets.length) return;
    sets.push('updated_at = now()');
    params.push(id);
    await client.query(`UPDATE tickets SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
  });

  const updated = await getTicketRow(id);
  // Authors only care about status changes; admins see everything.
  emitTicketUpdate(updated, 'ticket.updated', { toAuthor: changes.status !== undefined && changes.status !== row.status, toAdmins: true });
  return getTicketForAdmin(id);
}

/**
 * Sends a reply to the author. Side-effects that match how an ops team works:
 * records first-response time, auto-assigns an unassigned ticket to the sender,
 * and moves 'open' → 'in_progress' unless an explicit status is given.
 */
export async function addAdminReply(user, id, { body, aiAssisted = false, status }) {
  const row = await getTicketRow(id);
  if (!row) throw notFound('Ticket');
  if (row.status === 'closed' && !status) throw conflict('Ticket is closed. Re-open it before replying.');

  const nextStatus = status ?? (row.status === 'open' ? 'in_progress' : row.status);
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO ticket_messages (ticket_id, sender_id, sender_role, body, ai_assisted) VALUES ($1,$2,'admin',$3,$4)`,
      [id, user.id, body, aiAssisted]);
    await client.query(
      `UPDATE tickets SET status=$2,
         first_response_at = COALESCE(first_response_at, now()),
         assigned_to = COALESCE(assigned_to, $3),
         resolved_at = CASE WHEN $2 IN ('resolved','closed') THEN COALESCE(resolved_at, now()) ELSE NULL END,
         updated_at = now()
       WHERE id=$1`, [id, nextStatus, user.id]);
    await client.query(`INSERT INTO ticket_events (ticket_id, actor_id, type, to_value) VALUES ($1,$2,'replied',$3)`,
      [id, user.id, aiAssisted ? 'ai_assisted' : 'manual']);
    if (nextStatus !== row.status) {
      await client.query(`INSERT INTO ticket_events (ticket_id, actor_id, type, from_value, to_value) VALUES ($1,$2,'status_changed',$3,$4)`,
        [id, user.id, row.status, nextStatus]);
    }
  });
  const updated = await getTicketRow(id);
  emitTicketUpdate(updated, 'ticket.message');
  return getTicketForAdmin(id);
}

export async function addInternalNote(user, id, body) {
  const row = await getTicketRow(id);
  if (!row) throw notFound('Ticket');
  await query('INSERT INTO internal_notes (ticket_id, admin_id, body) VALUES ($1,$2,$3)', [id, user.id, body]);
  // Internal notes are never broadcast to the author.
  emitTicketUpdate(row, 'ticket.note', { toAuthor: false, toAdmins: true });
  return getTicketForAdmin(id);
}

export async function listAdmins() {
  const { rows } = await query(`SELECT id, name, email FROM users WHERE role='admin' ORDER BY name`);
  return rows;
}

export { getTicketRow, getMessages };
