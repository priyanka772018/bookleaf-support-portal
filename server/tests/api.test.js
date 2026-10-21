import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { api, resetDb, loginAuthor, loginAdmin, installMock, pool } from './helpers.js';
import { waitForBackgroundJobs } from '../src/services/aiService.js';
import { subscribe } from '../src/services/events.js';

const ANANYA = 'ananya.reddy@email.com'; // AUTH003, BK005 never paid
const SNEHA = 'sneha.kulkarni@email.com'; // AUTH007, 3 books incl. one in production
const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function createTicket(token, body = {}) {
  const res = await api().post('/api/tickets').set(auth(token)).send({
    bookId: 'BK005',
    subject: 'No royalty received yet',
    description: 'My book was published in July 2024 and I have not received any royalty at all. Please help.',
    ...body,
  });
  await waitForBackgroundJobs();
  return res;
}

before(resetDb);
after(() => pool.end());

describe('authentication', () => {
  test('login succeeds with seeded credentials', async () => {
    const res = await api().post('/api/auth/login').send({ email: ANANYA.toUpperCase(), password: 'Author@123' });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
    assert.equal(res.body.user.role, 'author');
    assert.equal(res.body.user.authorId, 'AUTH003');
  });

  test('wrong password → 401 with generic message', async () => {
    const res = await api().post('/api/auth/login').send({ email: ANANYA, password: 'nope' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.message, 'Incorrect email or password');
  });

  test('invalid body → 400 with field details', async () => {
    const res = await api().post('/api/auth/login').send({ email: 'not-an-email' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'BAD_REQUEST');
    assert.deepEqual(res.body.error.details.map((d) => d.field).sort(), ['email', 'password']);
  });

  test('protected routes require a token', async () => {
    assert.equal((await api().get('/api/books')).status, 401);
    assert.equal((await api().get('/api/admin/tickets').set(auth('garbage'))).status, 401);
  });
});

describe('books & role-based access', () => {
  test('author sees only their own books, including in-production ones', async () => {
    const token = await loginAuthor(SNEHA);
    const res = await api().get('/api/books').set(auth(token));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.books.map((b) => b.id).sort(), ['BK011', 'BK012', 'BK013']);
    const prod = res.body.books.find((b) => b.id === 'BK013');
    assert.equal(prod.isPublished, false);
    assert.equal(prod.mrp, null);
    assert.equal(res.body.summary.inProduction, 1);
  });

  test("author cannot read another author's book", async () => {
    const token = await loginAuthor(SNEHA);
    assert.equal((await api().get('/api/books/BK005').set(auth(token))).status, 404);
  });

  test('author cannot reach admin endpoints; admin cannot use author-only endpoints', async () => {
    const author = await loginAuthor(SNEHA);
    const admin = await loginAdmin();
    assert.equal((await api().get('/api/admin/tickets').set(auth(author))).status, 403);
    assert.equal((await api().get('/api/books').set(auth(admin))).status, 403);
  });
});

describe('ticket lifecycle with AI', () => {
  beforeEach(resetDb);

  test('ticket is created instantly, then AI classification is applied', async () => {
    const calls = installMock();
    const token = await loginAuthor(ANANYA);
    const res = await createTicket(token);
    assert.equal(res.status, 201);
    assert.match(res.body.ticket.ref, /^BL-\d{5}$/);
    assert.equal(res.body.ticket.priority, undefined, 'priority is internal, not shown to authors');

    const admin = await loginAdmin();
    const { body } = await api().get(`/api/admin/tickets/${res.body.ticket.id}`).set(auth(admin));
    assert.equal(body.ticket.category, 'royalty_payments');
    assert.equal(body.ticket.priority, 'critical');
    assert.equal(body.ticket.categorySource, 'ai');
    assert.equal(body.ticket.ai.status, 'completed');

    // Classifier gets no knowledge base — only the short rubric + ticket.
    const classify = calls.find((c) => c.purpose === 'classify');
    assert.doesNotMatch(classify.req.messages[0].content, /80\/20 royalty split/);
    assert.equal(classify.req.tool_choice.name, 'classify_ticket');
  });

  test('AI outage: ticket still created with keyword fallback, draft falls back to template', async () => {
    installMock({ classify: () => { throw new Error('503'); }, draft: () => { throw new Error('503'); } });
    const token = await loginAuthor(ANANYA);
    const res = await createTicket(token);
    assert.equal(res.status, 201);

    const admin = await loginAdmin();
    const { body } = await api().get(`/api/admin/tickets/${res.body.ticket.id}`).set(auth(admin));
    assert.equal(body.ticket.ai.status, 'fallback');
    assert.equal(body.ticket.categorySource, 'rules');
    assert.equal(body.ticket.category, 'royalty_payments');

    const draft = await api().get(`/api/admin/tickets/${res.body.ticket.id}/draft`).set(auth(admin));
    assert.equal(draft.status, 200);
    assert.equal(draft.body.draft.source, 'template');
    assert.match(draft.body.draft.content, /Hi Ananya/);

    // Admin can still reply manually.
    const reply = await api().post(`/api/admin/tickets/${res.body.ticket.id}/messages`).set(auth(admin)).send({ body: 'Manual reply from the team.' });
    assert.equal(reply.status, 201);
  });

  test('malformed AI output is rejected and falls back', async () => {
    installMock({ classify: () => ({ category: 'made_up', priority: 'urgent!!' }) });
    const token = await loginAuthor(ANANYA);
    const res = await createTicket(token);
    const admin = await loginAdmin();
    const { body } = await api().get(`/api/admin/tickets/${res.body.ticket.id}`).set(auth(admin));
    assert.equal(body.ticket.categorySource, 'rules');
    assert.match(body.ticket.ai.reasoning, /invalid_ai_output/);
  });

  test('circuit breaker stops calling the provider after repeated failures', async () => {
    const calls = installMock({ classify: () => { throw new Error('timeout'); } });
    const token = await loginAuthor(ANANYA);
    for (let i = 0; i < 5; i += 1) await createTicket(token, { subject: `Royalty question ${i}` });
    assert.equal(calls.length, 3, 'only threshold (3) calls reach the provider');
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ai_calls WHERE status='skipped'`);
    assert.equal(rows[0].n, 2);
  });

  test('admin overrides survive AI re-classification', async () => {
    installMock();
    const token = await loginAuthor(ANANYA);
    const { body: { ticket } } = await createTicket(token);
    const admin = await loginAdmin();
    const patch = await api().patch(`/api/admin/tickets/${ticket.id}`).set(auth(admin)).send({ category: 'general_inquiry', priority: 'low' });
    assert.equal(patch.status, 200);
    assert.equal(patch.body.ticket.categorySource, 'admin');

    const re = await api().post(`/api/admin/tickets/${ticket.id}/classify`).set(auth(admin));
    assert.equal(re.body.ticket.category, 'general_inquiry');
    assert.equal(re.body.ticket.priority, 'low');
    assert.ok(re.body.ticket.events.some((e) => e.type === 'category_overridden'));
  });

  test('draft uses only the relevant KB section + computed facts, and is cached', async () => {
    const calls = installMock();
    const token = await loginAuthor(ANANYA);
    const { body: { ticket } } = await createTicket(token);
    const admin = await loginAdmin();

    const first = await api().get(`/api/admin/tickets/${ticket.id}/draft`).set(auth(admin));
    assert.equal(first.body.draft.source, 'ai');
    assert.equal(first.body.draft.cached, false);
    assert.deepEqual(first.body.draft.checklist, ['Confirm bank details are linked']);

    const draftCall = calls.find((c) => c.purpose === 'draft');
    const prompt = draftCall.req.messages[0].content;
    assert.match(prompt, /ROYALTY POLICY/);
    assert.doesNotMatch(prompt, /PRINTING & QUALITY/);
    assert.match(prompt, /FLAG: ₹2,546 pending/);
    assert.equal(draftCall.req.system[0].cache_control.type, 'ephemeral');

    const second = await api().get(`/api/admin/tickets/${ticket.id}/draft`).set(auth(admin));
    assert.equal(second.body.draft.cached, true);
    assert.equal(calls.filter((c) => c.purpose === 'draft').length, 1, 'no second LLM call');

    const forced = await api().post(`/api/admin/tickets/${ticket.id}/draft`).set(auth(admin));
    assert.equal(forced.body.draft.cached, false);
    assert.equal(calls.filter((c) => c.purpose === 'draft').length, 2);
  });

  test('admin reply reaches the author; internal notes never do', async () => {
    installMock();
    const token = await loginAuthor(ANANYA);
    const { body: { ticket } } = await createTicket(token);
    const admin = await loginAdmin();

    const events = [];
    const unsubscribe = subscribe((e) => events.push(e));
    await api().post(`/api/admin/tickets/${ticket.id}/notes`).set(auth(admin)).send({ body: 'Bank details missing — check with finance.' });
    const reply = await api().post(`/api/admin/tickets/${ticket.id}/messages`).set(auth(admin))
      .send({ body: 'We have escalated your payout.', aiAssisted: true });
    unsubscribe();

    assert.equal(reply.body.ticket.status, 'in_progress', 'open → in_progress on first reply');
    assert.ok(reply.body.ticket.firstResponseAt);
    assert.equal(reply.body.ticket.assignee.name, 'Aisha Verma (Support Lead)', 'auto-assigned to replier');

    const authorView = await api().get(`/api/tickets/${ticket.id}`).set(auth(token));
    assert.equal(authorView.body.ticket.messages.at(-1).body, 'We have escalated your payout.');
    assert.equal(authorView.body.ticket.notes, undefined);
    assert.doesNotMatch(JSON.stringify(authorView.body), /Bank details missing/);

    const noteEvt = events.find((e) => e.type === 'ticket.note');
    const msgEvt = events.find((e) => e.type === 'ticket.message');
    assert.equal(noteEvt.toAuthor, false);
    assert.equal(msgEvt.toAuthor, true);
    assert.equal(msgEvt.payload.authorId, 'AUTH003');
  });

  test("authors can't see or reply to other authors' tickets (404)", async () => {
    installMock();
    const { body: { ticket } } = await createTicket(await loginAuthor(ANANYA));
    const other = await loginAuthor(SNEHA);
    assert.equal((await api().get(`/api/tickets/${ticket.id}`).set(auth(other))).status, 404);
    assert.equal((await api().post(`/api/tickets/${ticket.id}/messages`).set(auth(other)).send({ body: 'hi there' })).status, 404);
    const list = await api().get('/api/tickets').set(auth(other));
    assert.equal(list.body.tickets.length, 0);
  });

  test('validation: book must belong to the author; general tickets allowed', async () => {
    installMock();
    const token = await loginAuthor(ANANYA);
    const bad = await createTicket(token, { bookId: 'BK011' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.details[0].field, 'bookId');

    const short = await createTicket(token, { subject: 'Hi', description: 'short' });
    assert.equal(short.status, 400);
    assert.equal(short.body.error.details.length, 2);

    const general = await createTicket(token, { bookId: 'general', subject: 'Update my author bio', description: 'How can I update my author bio on all listings?' });
    assert.equal(general.status, 201);
    assert.equal(general.body.ticket.book, null);
  });

  test('author reply re-opens a resolved ticket; closed tickets reject replies', async () => {
    installMock();
    const token = await loginAuthor(ANANYA);
    const { body: { ticket } } = await createTicket(token);
    const admin = await loginAdmin();
    await api().patch(`/api/admin/tickets/${ticket.id}`).set(auth(admin)).send({ status: 'resolved' });
    const reopened = await api().post(`/api/tickets/${ticket.id}/messages`).set(auth(token)).send({ body: 'Still not received, sorry!' });
    assert.equal(reopened.body.ticket.status, 'open');

    await api().patch(`/api/admin/tickets/${ticket.id}`).set(auth(admin)).send({ status: 'closed' });
    const rejected = await api().post(`/api/tickets/${ticket.id}/messages`).set(auth(token)).send({ body: 'Hello again' });
    assert.equal(rejected.status, 409);
  });

  test('queue filtering, urgency sort, stats and AI usage', async () => {
    installMock({
      classify: (req) => (/ISBN/.test(req.messages[0].content)
        ? { category: 'isbn_metadata', priority: 'high', confidence: 0.9, reasoning: 'ISBN mismatch' }
        : { category: 'general_inquiry', priority: 'low', confidence: 0.8, reasoning: 'How-to' }),
    });
    const token = await loginAuthor(ANANYA);
    await createTicket(token, { bookId: null, subject: 'Can I update my bio?', description: 'I want to change my author bio please, how do I do it?' });
    await createTicket(token, { subject: 'ISBN mismatch on Amazon', description: 'The ISBN on Amazon differs from the one printed on my book.' });

    const admin = await loginAdmin();
    const all = await api().get('/api/admin/tickets').set(auth(admin));
    assert.equal(all.body.total, 2);
    assert.equal(all.body.items[0].priority, 'high', 'urgency sort puts high before low');

    const filtered = await api().get('/api/admin/tickets?priority=low&status=open').set(auth(admin));
    assert.equal(filtered.body.total, 1);
    const byRef = await api().get('/api/admin/tickets?q=BL-00002').set(auth(admin));
    assert.equal(byRef.body.items[0].id, 2);

    const badFilter = await api().get('/api/admin/tickets?priority=urgent').set(auth(admin));
    assert.equal(badFilter.status, 400);

    const stats = await api().get('/api/admin/tickets/stats').set(auth(admin));
    assert.equal(stats.body.stats.unresolved, 2);
    assert.equal(stats.body.stats.unassigned, 2);

    const usage = await api().get('/api/admin/ai/usage').set(auth(admin));
    assert.equal(usage.body.byPurpose.find((r) => r.purpose === 'classify').succeeded, 2);
  });

  test('unknown routes and bad ids return structured errors', async () => {
    const admin = await loginAdmin();
    const nf = await api().get('/api/nope').set(auth(admin));
    assert.equal(nf.status, 404);
    assert.equal(nf.body.error.code, 'NOT_FOUND');
    assert.equal((await api().get('/api/admin/tickets/abc').set(auth(admin))).status, 400);
    assert.equal((await api().get('/api/admin/tickets/9999').set(auth(admin))).status, 404);
    const emptyPatch = await api().patch('/api/admin/tickets/1').set(auth(admin)).send({});
    assert.equal(emptyPatch.status, 400);
  });
});
