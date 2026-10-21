import { api } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { num } from '../../components/format';
import { ErrorBanner, Spinner } from '../../components/ui';

export default function AiUsage() {
  const { data, error, loading, reload } = useAsync(() => api.get('/admin/ai/usage?days=30'), []);
  if (loading) return <Spinner />;
  if (error) return <ErrorBanner error={error} onRetry={reload} />;
  const { health, byPurpose, totals, replies } = data;
  const adoption = replies.replies ? Math.round((replies.ai_assisted / replies.replies) * 100) : 0;

  return (
    <>
      <div className="page-head">
        <div><h1>AI Usage</h1><p className="muted">Last {data.windowDays} days · model <code>{data.model}</code></p></div>
        <button className="btn btn-sm" onClick={() => reload()}>Refresh</button>
      </div>
      {!health.enabled && (
        <div className="alert alert-info">AI is disabled (no API key configured). New tickets are triaged by the keyword classifier and drafts use policy templates.</div>
      )}
      {health.circuit.open && (
        <div className="alert alert-error">The AI provider is failing; calls are paused until {new Date(health.circuit.openUntil).toLocaleTimeString()} and fallbacks are in use.</div>
      )}
      <section className="stats">
        <div className="stat"><span>AI calls</span><strong>{num(totals.calls)}</strong></div>
        <div className="stat"><span>Estimated spend</span><strong>${totals.estimatedCostUsd.toFixed(4)}</strong></div>
        <div className="stat"><span>Replies sent</span><strong>{num(replies.replies)}</strong></div>
        <div className="stat accent"><span>Started from AI draft</span><strong>{adoption}%</strong></div>
      </section>
      <div className="card table-wrap">
        <table className="queue static">
          <thead><tr><th>Purpose</th><th>Calls</th><th>OK</th><th>Failed</th><th>Skipped (circuit open)</th><th>Input tokens</th><th>Output tokens</th><th>Cache reads</th><th>Avg latency</th><th>Est. cost</th></tr></thead>
          <tbody>
            {byPurpose.length === 0 && <tr><td colSpan={10} className="muted center">No AI calls yet.</td></tr>}
            {byPurpose.map((r) => (
              <tr key={r.purpose}>
                <td className="strong">{r.purpose === 'classify' ? 'Triage' : 'Drafts'}</td>
                <td>{num(r.calls)}</td><td>{num(r.succeeded)}</td><td>{num(r.failed)}</td><td>{num(r.skipped)}</td>
                <td>{num(r.input_tokens)}</td><td>{num(r.output_tokens)}</td><td>{num(r.cache_read_tokens)}</td>
                <td>{r.avg_latency_ms} ms</td><td>${r.estimated_cost_usd.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">Drafts are cached per conversation state, so re-opening a ticket costs nothing. Each call sends only the knowledge-base sections for the ticket's category.</p>
    </>
  );
}
