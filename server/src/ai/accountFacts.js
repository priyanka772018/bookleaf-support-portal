/**
 * Deterministic "facts sheet" about an author's book(s), computed in code and
 * handed to the LLM. Dates and money arithmetic are done here — never by the
 * model — so drafts quote correct payout dates, thresholds and stages.
 */

export const PAYOUT_THRESHOLD = 1000;
export const PRODUCTION_STAGES = [
  'Manuscript Received', 'Editing', 'Cover Design', 'Typesetting', 'Proofreading',
  'ISBN Assignment', 'Printing', 'Distribution Setup', 'Published & Live',
];

const DAY = 24 * 60 * 60 * 1000;
const toISO = (d) => d.toISOString().slice(0, 10);
const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

/** Quarter end (UTC) for the quarter containing `date`. */
function quarterEnd(date) {
  const q = Math.floor(date.getUTCMonth() / 3);
  return new Date(Date.UTC(date.getUTCFullYear(), q * 3 + 3, 0));
}

/**
 * Royalty schedule relative to `today`: royalties for a quarter are paid
 * within 45 days of that quarter ending.
 */
export function payoutSchedule(today = new Date()) {
  const thisQuarterEnd = quarterEnd(today);
  const prevQuarterEnd = new Date(Date.UTC(thisQuarterEnd.getUTCFullYear(), thisQuarterEnd.getUTCMonth() - 2, 0));
  const prevDeadline = new Date(prevQuarterEnd.getTime() + 45 * DAY);
  // If the previous quarter's payout window is still open, that's the next payout.
  const [closedQuarterEnd, deadline] = prevDeadline >= today
    ? [prevQuarterEnd, prevDeadline]
    : [thisQuarterEnd, new Date(thisQuarterEnd.getTime() + 45 * DAY)];
  return {
    lastClosedQuarterEnd: toISO(closedQuarterEnd),
    nextPayoutDeadline: toISO(deadline),
  };
}

function productionStage(status) {
  if (!status || status === 'Published & Live') return null;
  const stage = PRODUCTION_STAGES.find((s) => status.toLowerCase().includes(s.toLowerCase()));
  if (!stage) return { current: status };
  const idx = PRODUCTION_STAGES.indexOf(stage);
  return {
    current: stage,
    step: `${idx + 1} of ${PRODUCTION_STAGES.length}`,
    remaining: PRODUCTION_STAGES.slice(idx + 1),
    commonDelayPoint: ['Cover Design', 'Proofreading'].includes(stage),
  };
}

/** Facts for a single book, as a compact list of lines. */
export function bookFacts(book, today = new Date()) {
  const lines = [
    `Book: "${book.title}" (${book.id}), ISBN ${book.isbn}, genre ${book.genre ?? 'n/a'}`,
    `Status: ${book.status}`,
  ];
  const stage = productionStage(book.status);
  if (stage) {
    lines.push(`Production: currently at ${stage.current}${stage.step ? ` (stage ${stage.step})` : ''}.`
      + (stage.remaining ? ` Remaining stages: ${stage.remaining.join(' → ')}.` : '')
      + (stage.commonDelayPoint ? ' This stage commonly waits on author approval / revision rounds.' : ''));
    lines.push('Not yet published: no MRP, no sales and no royalties yet (this is expected, not an error).');
    return lines;
  }

  lines.push(`Published: ${book.publication_date ?? 'unknown'}; MRP ${book.mrp != null ? inr(book.mrp) : 'n/a'}; `
    + `author royalty per copy ${book.author_royalty_per_copy != null ? inr(book.author_royalty_per_copy) : 'n/a'}`);
  lines.push(`Print partner: ${book.print_partner ?? 'n/a'}; available on: ${(book.available_on ?? []).join(', ') || 'none listed'}`);
  lines.push(`Sales: ${book.total_copies_sold} copies; royalty earned ${inr(book.total_royalty_earned)}, `
    + `paid ${inr(book.royalty_paid)}, pending ${inr(book.royalty_pending)}`);

  const pending = Number(book.royalty_pending);
  if (book.last_royalty_payout_date) {
    const days = Math.floor((today - new Date(`${book.last_royalty_payout_date}T00:00:00Z`)) / DAY);
    lines.push(`Last royalty payout: ${book.last_royalty_payout_date} (${days} days ago).`);
    // One full quarterly cycle + 45-day window ≈ 135 days. Beyond that with money pending, it's overdue.
    if (pending >= PAYOUT_THRESHOLD && days > 135) {
      lines.push(`FLAG: ${inr(pending)} pending and no payout for ${days} days — this looks OVERDUE on BookLeaf's side. Own it and escalate with a 48-hour timeline.`);
    }
  } else if (Number(book.total_royalty_earned) > 0) {
    lines.push('Last royalty payout: NONE — the author has never been paid for this book.');
    if (pending >= PAYOUT_THRESHOLD) {
      lines.push(`FLAG: ${inr(pending)} pending, above the ${inr(PAYOUT_THRESHOLD)} threshold, but never paid — likely OVERDUE; verify bank details are linked, own it and escalate with a 48-hour timeline.`);
    }
  }
  if (pending > 0 && pending < PAYOUT_THRESHOLD) {
    lines.push(`NOTE: pending ${inr(pending)} is below the ${inr(PAYOUT_THRESHOLD)} minimum payout threshold, so it rolls over to the next quarter.`);
  }
  if (pending === 0 && Number(book.total_royalty_earned) > 0) {
    lines.push('All royalties earned to date have been paid out.');
  }
  return lines;
}

/**
 * Builds the facts block for a ticket. For a book-specific ticket only that book
 * is included; for a general ticket, a one-line summary of each book (cheaper
 * than full detail for every title).
 */
export function buildAccountFacts({ author, books, ticketBookId, today = new Date() }) {
  const schedule = payoutSchedule(today);
  const lines = [
    `Today's date: ${toISO(today)}`,
    `Author: ${author.name} (${author.id}), ${author.city ?? ''}, with BookLeaf since ${author.joined_date ?? 'n/a'}`,
    `Royalty schedule: the most recently closed quarter ended ${schedule.lastClosedQuarterEnd}; its payout is due by ${schedule.nextPayoutDeadline}.`,
  ];
  const book = ticketBookId ? books.find((b) => b.id === ticketBookId) : null;
  if (book) {
    lines.push('', ...bookFacts(book, today));
  } else {
    lines.push('', 'Ticket is General / Account level. Author\'s books:');
    for (const b of books) {
      lines.push(`- "${b.title}" (${b.id}): ${b.status}; sold ${b.total_copies_sold}; pending ${inr(b.royalty_pending)}; last payout ${b.last_royalty_payout_date ?? 'never'}`);
    }
  }
  return lines.join('\n');
}
