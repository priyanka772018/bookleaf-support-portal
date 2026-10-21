import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, downloadFile } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { useLiveEvents } from '../../hooks/LiveEvents';
import { useAuth } from '../../auth/AuthContext';
import { CATEGORY_LABELS, PRIORITY_LABELS, SOURCE_LABELS, STATUS_LABELS, date, dateTime, inr, num, timeAgo } from '../../components/format';
import Thread from '../../components/Thread';
import { ErrorBanner, PriorityBadge, Spinner, StatusBadge } from '../../components/ui';

const EVENT_TEXT = {
  created: () => 'Ticket created',
  status_changed: (e) => `Status: ${STATUS_LABELS[e.from] ?? e.from} → ${STATUS_LABELS[e.to] ?? e.to}`,
  category_overridden: (e) => `Category overridden: ${CATEGORY_LABELS[e.from] ?? e.from} → ${CATEGORY_LABELS[e.to]}`,
  priority_overridden: (e) => `Priority overridden: ${PRIORITY_LABELS[e.from] ?? e.from} → ${PRIORITY_LABELS[e.to]}`,
  assigned: (e) => (e.to === 'unassigned' ? 'Unassigned' : `Assigned to ${e.to}`),
  replied: (e) => (e.to === 'ai_assisted' ? 'Replied (from AI draft)' : 'Replied'),
  ai_classified: (e) => `AI triage: ${e.to.replace(/_/g, ' ')}`,
  ai_fallback: (e) => `AI unavailable — keyword triage: ${e.to.replace(/_/g, ' ')}`,
};

/** AI draft + reply composer. The draft loads separately so the ticket renders instantly. */
function Composer({ ticket, onSent }) {
  const [draft, setDraft] = useState(null);
  const [draftState, setDraftState] = useState('loading'); // loading | ready | error
  const [body, setBody] = useState('');
  const [fromDraft, setFromDraft] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const touched = useRef(false);
  // Thread length the current draft/composer is based on.
  const [baseCount, setBaseCount] = useState(ticket.messages.length);

  async function loadDraft(force = false) {
    setDraftState('loading');
    try {
      const res = force ? await api.post(`/admin/tickets/${ticket.id}/draft`) : await api.get(`/admin/tickets/${ticket.id}/draft`);
      setDraft(res.draft);
      setDraftState('ready');
      // Pre-fill the composer unless the agent already started typing.
      if (!touched.current || force) { setBody(res.draft.content); setFromDraft(res.draft.source === 'ai' ? 'ai' : 'template'); touched.current = false; }
    } catch (err) {
      setDraftState('error');
      setError(err);
    }
  }

  useEffect(() => { loadDraft(); }, [ticket.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // If the author writes again while the agent has the ticket open, offer a fresh draft.
  const newAuthorMessage = ticket.messages.length > baseCount && ticket.messages.at(-1)?.senderRole === 'author';

  async function send(status) {
    if (body.trim().length < 2) return;
    setSending(true);
    setError(null);
    try {
      const res = await api.post(`/admin/tickets/${ticket.id}/messages`, { body: body.trim(), aiAssisted: fromDraft === 'ai', ...(status ? { status } : {}) });
      setBody('');
      setFromDraft(false);
      touched.current = false;
      setBaseCount(res.ticket.messages.length);
      setDraft(null);
      setDraftState('ready');
      onSent(res);
    } catch (err) {
      setError(err);
    } finally {
      setSending(false);
    }
  }

  const closed = ticket.status === 'closed';
  return (
    <section className="card composer">
      <div className="composer-head">
        <h3>Reply to {ticket.author.name.split(' ')[0]}</h3>
        <div className="composer-tools">
          {draftState === 'loading' && <span className="muted small"><span className="spin" /> Drafting with AI…</span>}
          {draft && draftState === 'ready' && (
            <span className={`badge ${draft.source === 'ai' ? 'badge-ai' : 'badge-warn'}`}>
              {draft.source === 'ai' ? `AI draft${draft.cached ? ' · cached' : ''}` : 'AI unavailable · policy template'}
            </span>
          )}
          <button className="btn btn-sm btn-ghost" disabled={draftState === 'loading'} onClick={() => loadDraft(true)}>↻ Regenerate</button>
        </div>
      </div>
      {newAuthorMessage && (
        <div className="alert alert-info">The author just replied. <button className="link" onClick={() => { setBaseCount(ticket.messages.length); loadDraft(true); }}>Draft a response to their new message</button></div>
      )}
      {draft?.checklist?.length > 0 && (
        <div className="checklist">
          <div className="small strong">Before sending</div>
          <ul>{draft.checklist.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      )}
      <textarea rows={12} value={body} disabled={closed}
        onChange={(e) => { touched.current = true; setBody(e.target.value); }}
        placeholder={closed ? 'Ticket is closed — change status to reply.' : 'Write a reply…'} />
      <ErrorBanner error={error} />
      <div className="form-actions">
        <span className="muted small grow">{{ ai: 'Started from AI draft — review before sending.', template: 'Started from policy template — personalise before sending.' }[fromDraft] ?? 'Manual reply.'} Visible to the author.</span>
        <button className="btn" disabled={sending || closed || body.trim().length < 2} onClick={() => send('resolved')}>Send & resolve</button>
        <button className="btn btn-primary" disabled={sending || closed || body.trim().length < 2} onClick={() => send()}>{sending ? 'Sending…' : 'Send reply'}</button>
      </div>
    </section>
  );
}

function Sidebar({ ticket, onUpdate, admins }) {
  const { user } = useAuth();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function patch(changes) {
    setBusy(true);
    setError(null);
    try { onUpdate(await api.patch(`/admin/tickets/${ticket.id}`, changes)); } catch (err) { setError(err); } finally { setBusy(false); }
  }
  async function addNote(e) {
    e.preventDefault();
    if (note.trim().length < 2) return;
    setBusy(true);
    try { onUpdate(await api.post(`/admin/tickets/${ticket.id}/notes`, { body: note.trim() })); setNote(''); } catch (err) { setError(err); } finally { setBusy(false); }
  }
  async function reclassify() {
    setBusy(true);
    try { onUpdate(await api.post(`/admin/tickets/${ticket.id}/classify`)); } catch (err) { setError(err); } finally { setBusy(false); }
  }

  const b = ticket.bookSnapshot;
  return (
    <aside className="sidebar">
      <ErrorBanner error={error} />
      <section className="card side-section">
        <label className="side-label">Status
          <select value={ticket.status} disabled={busy} onChange={(e) => patch({ status: e.target.value })}>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="side-label">Assignee
          <select value={ticket.assignee?.id ?? ''} disabled={busy} onChange={(e) => patch({ assigneeId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Unassigned</option>
            {admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        {ticket.assignee?.id !== user.id && (
          <button className="btn btn-sm btn-block" disabled={busy} onClick={() => patch({ assigneeId: user.id })}>Assign to me</button>
        )}
      </section>

      <section className="card side-section">
        <div className="side-title">Triage
          <button className="link small" disabled={busy} onClick={reclassify} title="Re-run AI classification (your overrides are kept)">Re-run AI</button>
        </div>
        <label className="side-label"><span className="side-label-row">Category <span className="src-tag">{SOURCE_LABELS[ticket.categorySource]}</span></span>
          <select value={ticket.category ?? ''} disabled={busy} onChange={(e) => patch({ category: e.target.value })}>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="side-label"><span className="side-label-row">Priority <span className="src-tag">{SOURCE_LABELS[ticket.prioritySource]}</span></span>
          <select value={ticket.priority ?? ''} disabled={busy} onChange={(e) => patch({ priority: e.target.value })}>
            {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        {ticket.ai.reasoning && (
          <p className="ai-reason small">
            {ticket.ai.status === 'pending' ? 'AI triage in progress…' : ticket.ai.reasoning}
            {ticket.ai.status === 'completed' && ticket.ai.confidence != null && <span className="muted"> ({Math.round(ticket.ai.confidence * 100)}% confident)</span>}
          </p>
        )}
      </section>

      {b && (
        <section className="card side-section">
          <div className="side-title">{ticket.book.title}</div>
          <dl className="kv kv-compact">
            <div><dt>Status</dt><dd>{b.status}</dd></div>
            <div><dt>ISBN</dt><dd>{b.isbn}</dd></div>
            {b.publicationDate && <div><dt>Published</dt><dd>{date(b.publicationDate)}</dd></div>}
            <div><dt>Sold</dt><dd>{num(b.copiesSold)}</dd></div>
            <div><dt>Earned</dt><dd>{inr(b.royaltyEarned)}</dd></div>
            <div><dt>Paid</dt><dd>{inr(b.royaltyPaid)}</dd></div>
            <div><dt>Pending</dt><dd className="strong">{inr(b.royaltyPending)}</dd></div>
            <div><dt>Last payout</dt><dd>{b.lastPayoutDate ? date(b.lastPayoutDate) : 'Never'}</dd></div>
            {b.printPartner && <div><dt>Printer</dt><dd>{b.printPartner}</dd></div>}
          </dl>
        </section>
      )}

      <section className="card side-section">
        <div className="side-title">Internal notes <span className="muted small">· team only</span></div>
        {ticket.notes.length === 0 && <p className="muted small">No notes yet.</p>}
        <ul className="notes">
          {ticket.notes.map((n) => <li key={n.id}><div className="small"><strong>{n.adminName?.split(' (')[0]}</strong> · {timeAgo(n.createdAt)}</div><div>{n.body}</div></li>)}
        </ul>
        <form onSubmit={addNote}>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note for the team…" />
          <button className="btn btn-sm btn-block" disabled={busy || note.trim().length < 2}>Add note</button>
        </form>
      </section>

      <section className="card side-section">
        <div className="side-title">Activity</div>
        <ul className="activity">
          {ticket.events.map((e) => (
            <li key={e.id}><span>{(EVENT_TEXT[e.type] ?? (() => e.type))(e)}</span><span className="muted small">{e.actorName ? `${e.actorName.split(' (')[0]} · ` : ''}{dateTime(e.createdAt)}</span></li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

export default function AdminTicketDetail() {
  const { id } = useParams();
  const { data, error, loading, reload, setData } = useAsync(() => api.get(`/admin/tickets/${id}`), [id]);
  const admins = useAsync(() => api.get('/admin/admins'), []);

  useLiveEvents((type, evt) => {
    if (type === 'refocus' || String(evt.ticketId) === String(id)) reload({ silent: true });
  });

  if (loading) return <Spinner />;
  if (error) return <ErrorBanner error={error} onRetry={reload} />;
  const t = data.ticket;

  return (
    <>
      <Link to="/admin" className="back">← Queue</Link>
      <div className="page-head">
        <div>
          <div className="muted small">{t.ref} · {t.author.name} ({t.author.email}) · {t.book ? t.book.title : 'General / Account'} · opened {dateTime(t.createdAt)}</div>
          <h1>{t.subject}</h1>
          <div className="head-badges">
            <PriorityBadge priority={t.priority} /> <StatusBadge status={t.status} />
            <span className="badge">{CATEGORY_LABELS[t.category]}</span>
            {t.sla.breached && <span className="badge prio-critical">Past {t.sla.targetHours}h response target</span>}
          </div>
        </div>
      </div>
      <div className="detail-grid">
        <div className="detail-main">
          {t.attachment && (
            <button className="btn btn-sm btn-ghost attach" onClick={() => downloadFile(`/tickets/${t.id}/attachment`, t.attachment.name)}>📎 {t.attachment.name}</button>
          )}
          <Thread messages={t.messages} viewer="admin" />
          <Composer key={t.id} ticket={t} onSent={setData} />
        </div>
        <Sidebar ticket={t} onUpdate={setData} admins={admins.data?.admins ?? []} />
      </div>
    </>
  );
}
