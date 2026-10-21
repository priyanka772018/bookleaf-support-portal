/** Admin-facing endpoints. All require role=admin. */
import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { adminListQuerySchema, adminReplySchema, idParamSchema, noteSchema, updateTicketSchema } from '../validators/schemas.js';
import { asyncHandler } from '../utils/errors.js';
import * as tickets from '../services/ticketService.js';
import { getOrCreateDraft, triageTicket, usageReport } from '../services/aiService.js';

const router = Router();
router.use(authenticate, requireRole('admin'));
const withId = validate(idParamSchema, 'params');

/** GET /api/admin/tickets?status=open,in_progress&priority=critical&category=...&sort=urgency */
router.get('/tickets', validate(adminListQuerySchema, 'query'), asyncHandler(async (req, res) => {
  res.json(await tickets.listAdminTickets(req.validatedQuery, req.user));
}));

/** GET /api/admin/tickets/stats → queue counters for the dashboard header */
router.get('/tickets/stats', asyncHandler(async (_req, res) => {
  res.json({ stats: await tickets.queueStats() });
}));

/** GET /api/admin/tickets/:id → full ticket incl. internal notes + audit trail */
router.get('/tickets/:id', withId, asyncHandler(async (req, res) => {
  res.json({ ticket: await tickets.getTicketForAdmin(req.params.id) });
}));

/** PATCH /api/admin/tickets/:id { status?, category?, priority?, assigneeId? } */
router.patch('/tickets/:id', withId, validate(updateTicketSchema), asyncHandler(async (req, res) => {
  res.json({ ticket: await tickets.updateTicket(req.user, req.params.id, req.body) });
}));

/** POST /api/admin/tickets/:id/messages { body, aiAssisted?, status? } → reply visible to author */
router.post('/tickets/:id/messages', withId, validate(adminReplySchema), asyncHandler(async (req, res) => {
  res.status(201).json({ ticket: await tickets.addAdminReply(req.user, req.params.id, req.body) });
}));

/** POST /api/admin/tickets/:id/notes { body } → internal note (never shown to author) */
router.post('/tickets/:id/notes', withId, validate(noteSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ ticket: await tickets.addInternalNote(req.user, req.params.id, req.body.body) });
}));

/** GET /api/admin/tickets/:id/draft → cached or freshly generated AI draft */
router.get('/tickets/:id/draft', withId, asyncHandler(async (req, res) => {
  res.json({ draft: await getOrCreateDraft(req.params.id) });
}));

/** POST /api/admin/tickets/:id/draft → force a new draft */
router.post('/tickets/:id/draft', withId, asyncHandler(async (req, res) => {
  res.status(201).json({ draft: await getOrCreateDraft(req.params.id, { force: true }) });
}));

/** POST /api/admin/tickets/:id/classify → re-run AI triage (admin overrides are kept) */
router.post('/tickets/:id/classify', withId, asyncHandler(async (req, res) => {
  await tickets.getTicketForAdmin(req.params.id); // 404 if missing
  await triageTicket(req.params.id);
  res.json({ ticket: await tickets.getTicketForAdmin(req.params.id) });
}));

/** GET /api/admin/admins → assignable admins */
router.get('/admins', asyncHandler(async (_req, res) => {
  res.json({ admins: await tickets.listAdmins() });
}));

/** GET /api/admin/ai/usage?days=30 → token usage, estimated cost, failure counts */
router.get('/ai/usage', asyncHandler(async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  res.json(await usageReport({ days }));
}));

export default router;
