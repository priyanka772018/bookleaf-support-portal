import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { useLiveEvents } from '../../hooks/LiveEvents';
import { CATEGORY_LABELS, PRIORITY_LABELS, STATUS_LABELS, timeAgo } from '../../components/format';
import { EmptyState, ErrorBanner, PriorityBadge, Spinner, StatusBadge } from '../../components/ui';

// Default view: what the team needs to work on, most urgent and oldest first.
const DEFAULTS = { status: 'open,in_progress', sort: 'urgency', assignee: 'any' };
const FILTER_KEYS = ['status', 'priority', 'category', 'assignee', 'from', 'to', 'q', 'sort'];

function useFilters() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => {
    const f = {};
    for (const k of FILTER_KEYS) f[k] = params.get(k) ?? DEFAULTS[k] ?? '';
    return f;
  }, [params]);
  const update = (patch) => {
    const next = { ...filters, ...patch };
    const p = new URLSearchParams();
    for (const k of FILTER_KEYS) if (next[k] && next[k] !== (DEFAULTS[k] ?? '')) p.set(k, next[k]);
    // Explicitly selecting "all statuses" must survive the default.
    if (next.status === '') p.set('status', '');
    setParams(p, { replace: true });
  };
  return [filters, update];
}

function StatsBar({ stats, onPick }) {
  if (!stats) return null;
  const items = [
    { label: 'Unresolved', value: stats.unresolved, pick: { status: 'open,in_progress', priority: '', assignee: 'any' } },
    { label: 'Critical', value: stats.critical, tone: 'critical', pick: { status: 'open,in_progress', priority: 'critical' } },
    { label: 'High', value: stats.high, tone: 'high', pick: { status: 'open,in_progress', priority: 'high' } },
    { label: 'Unassigned', value: stats.unassigned, pick: { status: 'open,in_progress', assignee: 'unassigned', priority: '' } },
    { label: 'Past first-response target', value: stats.sla_breached, tone: stats.sla_breached ? 'critical' : '', pick: { status: 'open,in_progress', sort: 'oldest', priority: '' } },
    { label: 'Resolved (7 days)', value: stats.resolved_7d, pick: { status: 'resolved', priority: '', sort: 'updated' } },
  ];
  return (
    <section className="stats stats-clickable">
      {items.map((s) => (
        <button key={s.label} className={`stat ${s.tone ? `tone-${s.tone}` : ''}`} onClick={() => onPick(s.pick)}>
          <span>{s.label}</span><strong>{s.value}</strong>
        </button>
      ))}
    </section>
  );
}

export default function Queue() {
  const navigate = useNavigate();
  const [filters, update] = useFilters();
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v && v !== 'any')).toString();
  const list = useAsync(() => api.get(`/admin/tickets?${qs}`), [qs]);
  const stats = useAsync(() => api.get('/admin/tickets/stats'), []);

  useLiveEvents((type) => {
    if (type === 'ticket.note') return;
    list.reload({ silent: true });
    stats.reload({ silent: true });
  });

  const statusSet = new Set(filters.status ? filters.status.split(',') : []);
  const toggleStatus = (s) => {
    const next = new Set(statusSet);
    if (next.has(s)) next.delete(s); else next.add(s);
    update({ status: [...next].join(',') });
  };

  return (
    <>
      <div className="page-head">
        <div><h1>Ticket Queue</h1><p className="muted">Sorted by priority, then oldest first. AI triage runs on every new ticket — override it anytime.</p></div>
      </div>
      <StatsBar stats={stats.data?.stats} onPick={(p) => update({ priority: '', category: '', assignee: 'any', q: '', from: '', to: '', sort: 'urgency', ...p })} />

      <section className="filters card">
        <div className="filter-group">
          <span className="filter-label">Status</span>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <button key={k} className={`chip ${statusSet.has(k) ? 'chip-on' : ''}`} onClick={() => toggleStatus(k)}>{v}</button>
          ))}
        </div>
        <div className="filter-row">
          <input className="search" placeholder="Search subject, author, book or BL-ref…" defaultValue={filters.q}
            onKeyDown={(e) => { if (e.key === 'Enter') update({ q: e.currentTarget.value.trim() }); }}
            onBlur={(e) => { if (e.currentTarget.value.trim() !== filters.q) update({ q: e.currentTarget.value.trim() }); }} />
          <select value={filters.priority} onChange={(e) => update({ priority: e.target.value })} aria-label="Priority">
            <option value="">All priorities</option>
            {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={filters.category} onChange={(e) => update({ category: e.target.value })} aria-label="Category">
            <option value="">All categories</option>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={filters.assignee} onChange={(e) => update({ assignee: e.target.value })} aria-label="Assignee">
            <option value="any">Anyone</option>
            <option value="me">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
          </select>
          <label className="date-filter">From <input type="date" value={filters.from} onChange={(e) => update({ from: e.target.value })} /></label>
          <label className="date-filter">To <input type="date" value={filters.to} onChange={(e) => update({ to: e.target.value })} /></label>
          <select value={filters.sort} onChange={(e) => update({ sort: e.target.value })} aria-label="Sort">
            <option value="urgency">Most urgent</option>
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
            <option value="updated">Recently updated</option>
          </select>
        </div>
      </section>

      {list.error && <ErrorBanner error={list.error} onRetry={list.reload} />}
      {list.loading && !list.data ? <Spinner /> : list.data && (
        list.data.items.length === 0 ? (
          <EmptyState title="Nothing here">No tickets match these filters.{' '}
            <button className="link" onClick={() => update({ status: 'open,in_progress', priority: '', category: '', assignee: 'any', q: '', from: '', to: '' })}>Reset filters</button>
          </EmptyState>
        ) : (
          <div className="table-wrap card">
            <table className="queue">
              <thead>
                <tr><th>Priority</th><th>Ticket</th><th>Author</th><th>Category</th><th>Status</th><th>Assignee</th><th>Age</th></tr>
              </thead>
              <tbody>
                {list.data.items.map((t) => (
                  <tr key={t.id} onClick={() => navigate(`/admin/tickets/${t.id}`)} className={t.sla.breached ? 'row-breached' : ''}>
                    <td><PriorityBadge priority={t.priority} />{t.prioritySource === 'admin' && <span className="src" title="Set by admin">✎</span>}</td>
                    <td className="cell-main">
                      <Link to={`/admin/tickets/${t.id}`} onClick={(e) => e.stopPropagation()}><span className="ref">{t.ref}</span> {t.subject}</Link>
                      <div className="muted small">
                        {t.book ? t.book.title : 'General / Account'}
                        {t.awaitingResponse && <span className="badge badge-await">Awaiting reply</span>}
                        {t.ai.status === 'pending' && <span className="badge badge-ai">AI triaging…</span>}
                      </div>
                    </td>
                    <td>{t.author.name}</td>
                    <td><span className="small">{CATEGORY_LABELS[t.category]}</span>{t.categorySource === 'rules' && <span className="src" title="Keyword fallback — review">⚠</span>}</td>
                    <td><StatusBadge status={t.status} /></td>
                    <td className="small">{t.assignee?.name.split(' (')[0] ?? <span className="muted">—</span>}</td>
                    <td className="small nowrap">{timeAgo(t.createdAt)}{t.sla.breached && <div className="warn-text small">Past {t.sla.targetHours}h target</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="table-foot muted small">{list.data.total} ticket{list.data.total === 1 ? '' : 's'}</div>
          </div>
        )
      )}
    </>
  );
}
