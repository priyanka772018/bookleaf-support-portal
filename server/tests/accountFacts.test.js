import { test } from 'node:test';
import assert from 'node:assert/strict';
import { payoutSchedule, bookFacts, buildAccountFacts } from '../src/ai/accountFacts.js';

const d = (s) => new Date(`${s}T00:00:00Z`);

test('payout schedule: previous quarter window still open', () => {
  assert.deepEqual(payoutSchedule(d('2026-10-21')), { lastClosedQuarterEnd: '2026-09-30', nextPayoutDeadline: '2026-11-14' });
});

test('payout schedule: previous window closed → next quarter', () => {
  assert.deepEqual(payoutSchedule(d('2026-12-01')), { lastClosedQuarterEnd: '2026-12-31', nextPayoutDeadline: '2027-02-14' });
});

const base = { id: 'BK', title: 'T', isbn: 'X', genre: 'g', status: 'Published & Live', publication_date: '2024-07-05', mrp: 425, author_royalty_per_copy: 38, print_partner: 'In-House', available_on: ['Amazon India'], total_copies_sold: 67 };

test('never-paid book above threshold is flagged overdue', () => {
  const lines = bookFacts({ ...base, total_royalty_earned: 2546, royalty_paid: 0, royalty_pending: 2546, last_royalty_payout_date: null }, d('2026-10-21')).join('\n');
  assert.match(lines, /never been paid/);
  assert.match(lines, /FLAG: ₹2,546 pending/);
});

test('pending below ₹1,000 threshold rolls over (no overdue flag)', () => {
  const lines = bookFacts({ ...base, total_royalty_earned: 850, royalty_paid: 0, royalty_pending: 850, last_royalty_payout_date: null }, d('2026-10-21')).join('\n');
  assert.match(lines, /below the ₹1,000 minimum payout threshold/);
  assert.doesNotMatch(lines, /FLAG/);
});

test('book in production reports stage and remaining steps, no royalty noise', () => {
  const lines = bookFacts({ ...base, status: 'In Production - Typesetting', mrp: null, publication_date: null, total_copies_sold: 0, total_royalty_earned: 0, royalty_paid: 0, royalty_pending: 0 }).join('\n');
  assert.match(lines, /currently at Typesetting \(stage 4 of 9\)/);
  assert.match(lines, /Proofreading → ISBN Assignment/);
  assert.match(lines, /Not yet published/);
});

test('general ticket summarises every book in one line each', () => {
  const facts = buildAccountFacts({
    author: { id: 'A', name: 'Kavita Deshmukh', city: 'Nagpur', joined_date: '2024-04-10' },
    books: [{ ...base, id: 'B1', title: 'One', royalty_pending: 0 }, { ...base, id: 'B2', title: 'Two', royalty_pending: 850 }],
    ticketBookId: null,
    today: d('2026-10-21'),
  });
  assert.match(facts, /General \/ Account level/);
  assert.match(facts, /"One" \(B1\)/);
  assert.match(facts, /"Two" \(B2\)/);
});
