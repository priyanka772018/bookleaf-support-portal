/**
 * Seeds the database from data/bookleaf_sample_data.json (the exact dataset
 * provided with the assignment), creates login accounts, and adds a handful of
 * realistic demo tickets so the admin queue isn't empty on first visit.
 *
 * Idempotent: authors/books are upserted. Pass --reset to wipe tickets first.
 *
 *   npm run seed               # upsert catalogue + accounts, add demo tickets if none exist
 *   npm run seed -- --reset    # also delete all tickets and re-create demo tickets
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { pool, withTransaction } from './pool.js';
import { classifyWithRules } from '../ai/ruleClassifier.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(here, '../../data/bookleaf_sample_data.json');

export const DEMO_AUTHOR_PASSWORD = 'Author@123';
export const DEMO_ADMIN_PASSWORD = 'Admin@123';
export const ADMINS = [
  { email: 'admin@bookleaf.com', name: 'Aisha Verma (Support Lead)' },
  { email: 'ops@bookleaf.com', name: 'Karan Mehta (Operations)' },
];

// Mirrors the sample queries in the brief's knowledge base.
const DEMO_TICKETS = [
  { author: 'AUTH003', book: 'BK005', hoursAgo: 70,
    subject: 'No royalty received since publication',
    description: 'My book was published in July 2024 and I have still not received a single royalty payment. My dashboard shows ₹2,546 pending. What is going on?' },
  { author: 'AUTH002', book: 'BK003', hoursAgo: 30,
    subject: 'Different ISBN on Amazon vs physical copy',
    description: 'The ISBN shown on the Amazon India listing for Code & Karma does not match the ISBN printed on the back cover of my author copies. Readers are getting confused.' },
  { author: 'AUTH005', book: 'BK009', hoursAgo: 20,
    subject: 'Blurry images and misaligned pages in author copies',
    description: 'I received my author copies of Letters from Lakshadweep and the print quality is terrible. Several photographs are blurry and pages 40-56 are misaligned.' },
  { author: 'AUTH010', book: 'BK018', hoursAgo: 8,
    subject: 'Book showing Currently Unavailable on Amazon',
    description: 'Howrah Nights is published but Amazon India shows it as "Currently Unavailable". I am running a launch promotion this weekend, please help.' },
  { author: 'AUTH009', book: 'BK015', hoursAgo: 4,
    subject: 'Still in typesetting after 3 weeks',
    description: 'It has been 3 weeks and Raising Roots is still in typesetting. When will it be done?' },
  { author: 'AUTH001', book: null, hoursAgo: 2,
    subject: 'Can I update my author bio?',
    description: 'Hi team, I would like to update my author bio across all my listings. How do I do that?' },
];

async function seedCatalogue(client, data) {
  for (const a of data.authors) {
    await client.query(
      `INSERT INTO authors (id, name, email, phone, city, joined_date)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, email=EXCLUDED.email,
         phone=EXCLUDED.phone, city=EXCLUDED.city, joined_date=EXCLUDED.joined_date`,
      [a.author_id, a.name, a.email.toLowerCase(), a.phone, a.city, a.joined_date],
    );
    for (const b of a.books) {
      await client.query(
        `INSERT INTO books (id, author_id, title, isbn, genre, publication_date, status, mrp,
           author_royalty_per_copy, total_copies_sold, total_royalty_earned, royalty_paid,
           royalty_pending, last_royalty_payout_date, print_partner, available_on)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (id) DO UPDATE SET author_id=EXCLUDED.author_id, title=EXCLUDED.title,
           isbn=EXCLUDED.isbn, genre=EXCLUDED.genre, publication_date=EXCLUDED.publication_date,
           status=EXCLUDED.status, mrp=EXCLUDED.mrp,
           author_royalty_per_copy=EXCLUDED.author_royalty_per_copy,
           total_copies_sold=EXCLUDED.total_copies_sold,
           total_royalty_earned=EXCLUDED.total_royalty_earned, royalty_paid=EXCLUDED.royalty_paid,
           royalty_pending=EXCLUDED.royalty_pending,
           last_royalty_payout_date=EXCLUDED.last_royalty_payout_date,
           print_partner=EXCLUDED.print_partner, available_on=EXCLUDED.available_on`,
        [b.book_id, a.author_id, b.title, b.isbn, b.genre, b.publication_date, b.status, b.mrp,
          b.author_royalty_per_copy, b.total_copies_sold ?? 0, b.total_royalty_earned ?? 0,
          b.royalty_paid ?? 0, b.royalty_pending ?? 0, b.last_royalty_payout_date,
          b.print_partner, b.available_on ?? []],
      );
    }
  }
}

async function seedUsers(client, data) {
  const authorHash = await bcrypt.hash(DEMO_AUTHOR_PASSWORD, 10);
  const adminHash = await bcrypt.hash(DEMO_ADMIN_PASSWORD, 10);
  for (const a of data.authors) {
    await client.query(
      `INSERT INTO users (email, password_hash, name, role, author_id)
       VALUES ($1,$2,$3,'author',$4)
       ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, name=EXCLUDED.name`,
      [a.email.toLowerCase(), authorHash, a.name, a.author_id],
    );
  }
  for (const admin of ADMINS) {
    await client.query(
      `INSERT INTO users (email, password_hash, name, role) VALUES ($1,$2,$3,'admin')
       ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, name=EXCLUDED.name`,
      [admin.email, adminHash, admin.name],
    );
  }
}

async function seedDemoTickets(client) {
  for (const t of DEMO_TICKETS) {
    const { category, priority } = classifyWithRules({ subject: t.subject, description: t.description });
    const { rows: [ticket] } = await client.query(
      `INSERT INTO tickets (author_id, book_id, subject, description, category, category_source,
         priority, priority_source, ai_status, ai_reasoning, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,'rules',$6,'rules','fallback',
         'Seeded demo ticket — classified by the keyword fallback classifier.',
         now() - make_interval(hours => $7), now() - make_interval(hours => $7))
       RETURNING id, author_id`,
      [t.author, t.book, t.subject, t.description, category, priority, t.hoursAgo],
    );
    const { rows: [author] } = await client.query('SELECT id FROM users WHERE author_id=$1', [t.author]);
    await client.query(
      `INSERT INTO ticket_messages (ticket_id, sender_id, sender_role, body, created_at)
       VALUES ($1,$2,'author',$3, now() - make_interval(hours => $4))`,
      [ticket.id, author.id, t.description, t.hoursAgo],
    );
    await client.query(
      `INSERT INTO ticket_events (ticket_id, actor_id, type, to_value, created_at)
       VALUES ($1,$2,'created','open', now() - make_interval(hours => $3))`,
      [ticket.id, author.id, t.hoursAgo],
    );
  }
}

export async function seed({ reset = false, demoTickets = true, log = console.log } = {}) {
  const data = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
  await withTransaction(async (client) => {
    if (reset) await client.query('TRUNCATE tickets, ai_calls RESTART IDENTITY CASCADE');
    await seedCatalogue(client, data);
    await seedUsers(client, data);
    const { rows: [{ count }] } = await client.query('SELECT count(*)::int AS count FROM tickets');
    if (demoTickets && count === 0) await seedDemoTickets(client);
  });
  const bookCount = data.authors.reduce((n, a) => n + a.books.length, 0);
  log(`✔ seeded ${data.authors.length} authors, ${bookCount} books, ${ADMINS.length} admins`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed({ reset: process.argv.includes('--reset') })
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => pool.end());
}
