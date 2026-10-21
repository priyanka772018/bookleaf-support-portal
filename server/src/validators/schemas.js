import { z } from 'zod';
import { CATEGORY_KEYS, PRIORITIES, STATUSES } from '../config/constants.js';

const trimmed = (min, max, label) => z.string({ error: (iss) => (iss.input === undefined ? `${label} is required` : `${label} must be text`) })
  .trim().min(min, `${label} must be at least ${min} characters`).max(max, `${label} must be at most ${max} characters`);

/** Accepts "a,b" or ["a","b"] from a query string. */
const csvEnum = (values) => z.preprocess(
  (v) => (v === undefined || v === '' ? undefined : (Array.isArray(v) ? v : String(v).split(',')).map((s) => s.trim()).filter(Boolean)),
  z.array(z.enum(values)).optional(),
);

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required').max(200),
});

export const createTicketSchema = z.object({
  // '' or 'general' from the form both mean General / Account level.
  bookId: z.preprocess((v) => (v === '' || v === 'general' || v == null ? null : v), z.string().max(20).nullable()),
  subject: trimmed(5, 150, 'Subject'),
  description: trimmed(20, 5000, 'Description'),
});

export const messageSchema = z.object({ body: trimmed(2, 5000, 'Message') });

export const adminReplySchema = z.object({
  body: trimmed(2, 5000, 'Reply'),
  aiAssisted: z.boolean().optional().default(false),
  status: z.enum(STATUSES).optional(),
});

export const noteSchema = z.object({ body: trimmed(2, 2000, 'Note') });

export const updateTicketSchema = z.object({
  status: z.enum(STATUSES).optional(),
  category: z.enum(CATEGORY_KEYS).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
}).strict().refine((o) => Object.keys(o).length > 0, { message: 'Provide at least one field to update' });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional();

export const adminListQuerySchema = z.object({
  status: csvEnum(STATUSES),
  category: csvEnum(CATEGORY_KEYS),
  priority: csvEnum(PRIORITIES),
  assignee: z.enum(['me', 'unassigned', 'any']).optional().default('any'),
  from: isoDate,
  to: isoDate,
  q: z.string().trim().max(100).optional().transform((v) => v || undefined),
  sort: z.enum(['urgency', 'oldest', 'newest', 'updated']).optional().default('urgency'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const idParamSchema = z.object({ id: z.coerce.number().int().positive('Invalid ticket id') });
