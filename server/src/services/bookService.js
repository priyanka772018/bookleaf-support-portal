import { query } from '../db/pool.js';
import { notFound } from '../utils/errors.js';

const BOOK_COLUMNS = `id, title, isbn, genre, publication_date, status, mrp, author_royalty_per_copy,
  total_copies_sold, total_royalty_earned, royalty_paid, royalty_pending,
  last_royalty_payout_date, print_partner, available_on`;

function toView(b) {
  return {
    id: b.id,
    title: b.title,
    isbn: b.isbn,
    genre: b.genre,
    publicationDate: b.publication_date,
    status: b.status,
    isPublished: b.status === 'Published & Live',
    mrp: b.mrp,
    royaltyPerCopy: b.author_royalty_per_copy,
    totalCopiesSold: b.total_copies_sold,
    totalRoyaltyEarned: b.total_royalty_earned,
    royaltyPaid: b.royalty_paid,
    royaltyPending: b.royalty_pending,
    lastRoyaltyPayoutDate: b.last_royalty_payout_date,
    printPartner: b.print_partner,
    availableOn: b.available_on,
  };
}

/** Raw rows (snake_case) — used to build AI account facts. */
export async function getBooksRaw(authorId) {
  const { rows } = await query(`SELECT ${BOOK_COLUMNS} FROM books WHERE author_id=$1 ORDER BY publication_date DESC NULLS FIRST, id`, [authorId]);
  return rows;
}

export async function listBooks(authorId) {
  const rows = await getBooksRaw(authorId);
  const books = rows.map(toView);
  const sum = (k) => books.reduce((n, b) => n + Number(b[k] || 0), 0);
  return {
    books,
    summary: {
      totalBooks: books.length,
      published: books.filter((b) => b.isPublished).length,
      inProduction: books.filter((b) => !b.isPublished).length,
      totalCopiesSold: sum('totalCopiesSold'),
      totalRoyaltyEarned: sum('totalRoyaltyEarned'),
      royaltyPaid: sum('royaltyPaid'),
      royaltyPending: sum('royaltyPending'),
    },
  };
}

export async function getBook(authorId, bookId) {
  const { rows } = await query(`SELECT ${BOOK_COLUMNS} FROM books WHERE id=$1 AND author_id=$2`, [bookId, authorId]);
  if (!rows.length) throw notFound('Book');
  return toView(rows[0]);
}

export async function getAuthor(authorId) {
  const { rows } = await query('SELECT id, name, email, phone, city, joined_date FROM authors WHERE id=$1', [authorId]);
  return rows[0] ?? null;
}
