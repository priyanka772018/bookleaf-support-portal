export const inr = (n) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN')}`);
export const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'));

export function date(d) {
  if (!d) return '—';
  return new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function dateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function timeAgo(d) {
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const STATUS_LABELS = { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', closed: 'Closed' };
export const PRIORITY_LABELS = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
export const CATEGORY_LABELS = {
  royalty_payments: 'Royalty & Payments',
  isbn_metadata: 'ISBN & Metadata',
  printing_quality: 'Printing & Quality',
  distribution_availability: 'Distribution & Availability',
  book_status_production: 'Book Status & Production',
  general_inquiry: 'General Inquiry',
};
export const SOURCE_LABELS = { ai: 'AI', rules: 'Keyword fallback', admin: 'Set by admin' };
