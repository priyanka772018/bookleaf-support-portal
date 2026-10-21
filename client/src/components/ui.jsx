import { STATUS_LABELS, PRIORITY_LABELS } from './format';

export const StatusBadge = ({ status }) => <span className={`badge status-${status}`}>{STATUS_LABELS[status] ?? status}</span>;

export const PriorityBadge = ({ priority }) => priority
  ? <span className={`badge prio-${priority}`}><span className="dot" />{PRIORITY_LABELS[priority]}</span>
  : null;

export const Spinner = ({ label = 'Loading…' }) => <div className="spinner" role="status"><span className="spin" />{label}</div>;

export function EmptyState({ title, children, action }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorBanner({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      <span>{error.message ?? String(error)}</span>
      {onRetry && <button className="btn btn-sm" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function Field({ label, error, hint, children, htmlFor }) {
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <div className="field-error">{error}</div> : hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}
