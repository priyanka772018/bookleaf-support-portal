import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { useLiveEvents } from '../../hooks/LiveEvents';
import { timeAgo } from '../../components/format';
import { EmptyState, ErrorBanner, Spinner, StatusBadge } from '../../components/ui';

export default function MyTickets() {
  const { data, error, loading, reload } = useAsync(() => api.get('/tickets'), []);
  useLiveEvents(() => reload({ silent: true }));

  if (loading) return <Spinner />;
  if (error) return <ErrorBanner error={error} onRetry={reload} />;
  const tickets = data.tickets;

  return (
    <>
      <div className="page-head">
        <div><h1>My Tickets</h1><p className="muted">Replies from our team appear here instantly.</p></div>
        <Link className="btn btn-primary" to="/tickets/new">New ticket</Link>
      </div>
      {tickets.length === 0 ? (
        <EmptyState title="No tickets yet" action={<Link className="btn btn-primary" to="/tickets/new">Raise your first ticket</Link>}>
          Questions about royalties, ISBNs, printing or your book's status? We're here to help.
        </EmptyState>
      ) : (
        <ul className="ticket-list">
          {tickets.map((t) => (
            <li key={t.id}>
              <Link to={`/tickets/${t.id}`} className={`ticket-row ${t.awaitingAuthor && ['open', 'in_progress'].includes(t.status) ? 'has-reply' : ''}`}>
                <div className="ticket-main">
                  <div className="ticket-title">
                    <span className="ref">{t.ref}</span> {t.subject}
                    {t.awaitingAuthor && ['open', 'in_progress'].includes(t.status) && <span className="badge badge-new">New reply</span>}
                  </div>
                  <div className="muted small">{t.book ? t.book.title : 'General / Account'} · updated {timeAgo(t.lastMessageAt)}</div>
                </div>
                <StatusBadge status={t.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
