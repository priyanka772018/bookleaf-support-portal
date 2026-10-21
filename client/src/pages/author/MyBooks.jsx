import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { inr, num, date } from '../../components/format';
import { EmptyState, ErrorBanner, Spinner } from '../../components/ui';

function RoyaltyNote({ book }) {
  if (!book.isPublished) return <span className="muted small">Royalties start once the book is live.</span>;
  if (book.royaltyPending > 0 && book.royaltyPending < 1000) {
    return <span className="muted small">Below the ₹1,000 payout minimum — rolls over to next quarter.</span>;
  }
  if (!book.lastRoyaltyPayoutDate && book.totalRoyaltyEarned > 0) return <span className="small warn-text">No payout yet</span>;
  return <span className="muted small">Last payout {date(book.lastRoyaltyPayoutDate)}</span>;
}

function BookCard({ book }) {
  return (
    <article className={`book-card ${book.isPublished ? '' : 'in-production'}`}>
      <header>
        <div>
          <h3>{book.title}</h3>
          <div className="muted small">{book.genre} · ISBN {book.isbn}</div>
        </div>
        <span className={`badge ${book.isPublished ? 'status-resolved' : 'status-in_progress'}`}>{book.status}</span>
      </header>
      <dl className="kv">
        <div><dt>Published</dt><dd>{book.isPublished ? date(book.publicationDate) : 'In production'}</dd></div>
        <div><dt>MRP</dt><dd>{inr(book.mrp)}</dd></div>
        <div><dt>Copies sold</dt><dd>{num(book.totalCopiesSold)}</dd></div>
        <div><dt>Royalty earned</dt><dd>{inr(book.totalRoyaltyEarned)}</dd></div>
        <div><dt>Royalty paid</dt><dd>{inr(book.royaltyPaid)}</dd></div>
        <div><dt>Royalty pending</dt><dd className={book.royaltyPending > 0 ? 'strong' : ''}>{inr(book.royaltyPending)}</dd></div>
      </dl>
      {book.availableOn?.length > 0 && (
        <div className="platforms">{book.availableOn.map((p) => <span key={p} className="chip chip-static">{p}</span>)}</div>
      )}
      <footer>
        <RoyaltyNote book={book} />
        <Link className="btn btn-sm" to={`/tickets/new?book=${book.id}`}>Ask about this book</Link>
      </footer>
    </article>
  );
}

export default function MyBooks() {
  const { data, error, loading, reload } = useAsync(() => api.get('/books'), []);
  if (loading) return <Spinner />;
  if (error) return <ErrorBanner error={error} onRetry={reload} />;
  const { books, summary } = data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My Books</h1>
          <p className="muted">Royalties are calculated quarterly and paid within 45 days of each quarter ending.</p>
        </div>
      </div>
      {books.length === 0 ? (
        <EmptyState title="No books yet">Once your manuscript is received, your book will appear here.</EmptyState>
      ) : (
        <>
          <section className="stats">
            <div className="stat"><span>Books</span><strong>{summary.totalBooks}</strong><em>{summary.published} live · {summary.inProduction} in production</em></div>
            <div className="stat"><span>Copies sold</span><strong>{num(summary.totalCopiesSold)}</strong></div>
            <div className="stat"><span>Royalty earned</span><strong>{inr(summary.totalRoyaltyEarned)}</strong></div>
            <div className="stat"><span>Paid to you</span><strong>{inr(summary.royaltyPaid)}</strong></div>
            <div className="stat accent"><span>Pending</span><strong>{inr(summary.royaltyPending)}</strong></div>
          </section>
          <div className="book-grid">{books.map((b) => <BookCard key={b.id} book={b} />)}</div>
        </>
      )}
    </>
  );
}
