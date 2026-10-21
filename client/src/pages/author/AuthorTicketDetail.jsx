import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api, downloadFile } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { useLiveEvents } from '../../hooks/LiveEvents';
import { date } from '../../components/format';
import Thread from '../../components/Thread';
import { ErrorBanner, Spinner, StatusBadge } from '../../components/ui';

export default function AuthorTicketDetail() {
  const { id } = useParams();
  const location = useLocation();
  const { data, error, loading, reload, setData } = useAsync(() => api.get(`/tickets/${id}`), [id]);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);

  useLiveEvents((type, evt) => {
    if (type === 'refocus' || String(evt.ticketId) === String(id)) reload({ silent: true });
  });

  if (loading) return <Spinner />;
  if (error) return <ErrorBanner error={error} onRetry={reload} />;
  const t = data.ticket;

  async function send(e) {
    e.preventDefault();
    if (reply.trim().length < 2) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await api.post(`/tickets/${id}/messages`, { body: reply.trim() });
      setData(res);
      setReply('');
    } catch (err) {
      setSendError(err);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="narrow">
      <Link to="/tickets" className="back">← All tickets</Link>
      {location.state?.justCreated && (
        <div className="alert alert-success">Thanks — your ticket {t.ref} has been received. You'll see our reply here as soon as it's sent.</div>
      )}
      <div className="page-head">
        <div>
          <div className="muted small">{t.ref} · opened {date(t.createdAt)} · {t.book ? t.book.title : 'General / Account'}</div>
          <h1>{t.subject}</h1>
        </div>
        <StatusBadge status={t.status} />
      </div>
      {t.attachment && (
        <button className="btn btn-sm btn-ghost attach" onClick={() => downloadFile(`/tickets/${t.id}/attachment`, t.attachment.name)}>📎 {t.attachment.name}</button>
      )}
      <Thread messages={t.messages} viewer="author" />
      {t.status !== 'closed' ? (
        <form className="card reply-box" onSubmit={send}>
          <label htmlFor="reply" className="small strong">{t.status === 'resolved' ? 'Still need help? Replying will re-open this ticket.' : 'Add a reply'}</label>
          <textarea id="reply" rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a message to the BookLeaf team…" />
          <ErrorBanner error={sendError} />
          <div className="form-actions"><button className="btn btn-primary" disabled={sending || reply.trim().length < 2}>{sending ? 'Sending…' : 'Send'}</button></div>
        </form>
      ) : (
        <p className="muted center">This ticket is closed. <Link to="/tickets/new">Raise a new ticket</Link> if you need more help.</p>
      )}
    </div>
  );
}
