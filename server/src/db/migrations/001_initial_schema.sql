-- BookLeaf Author Support Portal — initial schema

CREATE TABLE authors (
  id           TEXT PRIMARY KEY,               -- e.g. AUTH001 (business id from the catalogue)
  name         TEXT NOT NULL,
  email        TEXT NOT NULL UNIQUE,
  phone        TEXT,
  city         TEXT,
  joined_date  DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE books (
  id                       TEXT PRIMARY KEY,   -- e.g. BK001
  author_id                TEXT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  title                    TEXT NOT NULL,
  isbn                     TEXT NOT NULL UNIQUE,
  genre                    TEXT,
  publication_date         DATE,               -- NULL while in production
  status                   TEXT NOT NULL,
  mrp                      NUMERIC(10,2),      -- NULL while in production
  author_royalty_per_copy  NUMERIC(10,2),
  total_copies_sold        INTEGER NOT NULL DEFAULT 0 CHECK (total_copies_sold >= 0),
  total_royalty_earned     NUMERIC(12,2) NOT NULL DEFAULT 0,
  royalty_paid             NUMERIC(12,2) NOT NULL DEFAULT 0,
  royalty_pending          NUMERIC(12,2) NOT NULL DEFAULT 0,
  last_royalty_payout_date DATE,
  print_partner            TEXT,
  available_on             TEXT[] NOT NULL DEFAULT '{}',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_books_author ON books(author_id);

-- Login identities. Authors link to their catalogue record; admins do not.
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('author', 'admin')),
  author_id     TEXT UNIQUE REFERENCES authors(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((role = 'author' AND author_id IS NOT NULL) OR (role = 'admin' AND author_id IS NULL))
);

CREATE TABLE tickets (
  id                  SERIAL PRIMARY KEY,
  author_id           TEXT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  book_id             TEXT REFERENCES books(id) ON DELETE SET NULL,  -- NULL = General / Account level
  subject             TEXT NOT NULL,
  description         TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),

  category            TEXT CHECK (category IN ('royalty_payments', 'isbn_metadata', 'printing_quality',
                                               'distribution_availability', 'book_status_production',
                                               'general_inquiry')),
  category_source     TEXT CHECK (category_source IN ('ai', 'rules', 'admin')),
  priority            TEXT CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  priority_source     TEXT CHECK (priority_source IN ('ai', 'rules', 'admin')),
  ai_status           TEXT NOT NULL DEFAULT 'pending'
                        CHECK (ai_status IN ('pending', 'completed', 'fallback')),
  ai_confidence       NUMERIC(3,2),
  ai_reasoning        TEXT,

  assigned_to         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  attachment_name     TEXT,
  attachment_path     TEXT,
  attachment_mime     TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_response_at   TIMESTAMPTZ,
  resolved_at         TIMESTAMPTZ
);
CREATE INDEX idx_tickets_author ON tickets(author_id, created_at DESC);
CREATE INDEX idx_tickets_queue  ON tickets(status, priority, created_at);
CREATE INDEX idx_tickets_category ON tickets(category);

-- Author-visible conversation thread (author messages + admin replies).
CREATE TABLE ticket_messages (
  id             SERIAL PRIMARY KEY,
  ticket_id      INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  sender_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sender_role    TEXT NOT NULL CHECK (sender_role IN ('author', 'admin')),
  body           TEXT NOT NULL,
  ai_assisted    BOOLEAN NOT NULL DEFAULT false,   -- reply started from an AI draft
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_ticket ON ticket_messages(ticket_id, created_at);

-- Admin-only notes; never returned by author-facing endpoints.
CREATE TABLE internal_notes (
  id          SERIAL PRIMARY KEY,
  ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  admin_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notes_ticket ON internal_notes(ticket_id, created_at);

-- Audit trail: status changes, overrides, assignment, AI results.
CREATE TABLE ticket_events (
  id          SERIAL PRIMARY KEY,
  ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type        TEXT NOT NULL,
  from_value  TEXT,
  to_value    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_ticket ON ticket_events(ticket_id, created_at);

-- Cached AI drafts. A draft is reused until the conversation changes,
-- so opening the same ticket repeatedly costs zero extra tokens.
CREATE TABLE ai_drafts (
  id                  SERIAL PRIMARY KEY,
  ticket_id           INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  content             TEXT NOT NULL,
  admin_checklist     JSONB NOT NULL DEFAULT '[]',
  source              TEXT NOT NULL CHECK (source IN ('ai', 'template')),
  failure_reason      TEXT,
  model               TEXT,
  message_count       INTEGER NOT NULL,   -- thread length the draft was generated for
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_drafts_ticket ON ai_drafts(ticket_id, created_at DESC);

-- Every LLM call is logged for cost/latency/error observability.
CREATE TABLE ai_calls (
  id             SERIAL PRIMARY KEY,
  ticket_id      INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  purpose        TEXT NOT NULL CHECK (purpose IN ('classify', 'draft')),
  model          TEXT,
  status         TEXT NOT NULL CHECK (status IN ('success', 'error', 'skipped')),
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms     INTEGER,
  error          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_calls_created ON ai_calls(created_at DESC);
