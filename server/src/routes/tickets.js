/** Author-facing ticket endpoints. Every query is scoped to req.user.authorId. */
import fs from 'node:fs';
import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ticketAttachment, uploadPath } from '../middleware/upload.js';
import { createTicketSchema, messageSchema, idParamSchema } from '../validators/schemas.js';
import { asyncHandler, notFound } from '../utils/errors.js';
import * as tickets from '../services/ticketService.js';
import { triageInBackground } from '../services/aiService.js';

const router = Router();
router.use(authenticate);

/** GET /api/tickets → my tickets (newest activity first) */
router.get('/', requireRole('author'), asyncHandler(async (req, res) => {
  res.json({ tickets: await tickets.listAuthorTickets(req.user) });
}));

/**
 * POST /api/tickets (JSON or multipart/form-data with optional `attachment`)
 * Responds immediately; AI classification runs in the background.
 */
router.post('/', requireRole('author'), ticketAttachment, validate(createTicketSchema), asyncHandler(async (req, res) => {
  const { row, view } = await tickets.createTicket({ user: req.user, ...req.body, attachment: req.file });
  triageInBackground(row.id);
  res.status(201).json({ ticket: view });
}));

/** GET /api/tickets/:id → ticket + public conversation */
router.get('/:id', requireRole('author'), validate(idParamSchema, 'params'), asyncHandler(async (req, res) => {
  res.json({ ticket: await tickets.getTicketForAuthor(req.user, req.params.id) });
}));

/** POST /api/tickets/:id/messages → author follow-up */
router.post('/:id/messages', requireRole('author'), validate(idParamSchema, 'params'), validate(messageSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({ ticket: await tickets.addAuthorMessage(req.user, req.params.id, req.body.body) });
  }));

/** GET /api/tickets/:id/attachment → download (owner author or any admin) */
router.get('/:id/attachment', validate(idParamSchema, 'params'), asyncHandler(async (req, res) => {
  const file = await tickets.getAttachment(req.user, req.params.id);
  const full = uploadPath(file.path);
  if (!fs.existsSync(full)) throw notFound('Attachment');
  res.type(file.mime).attachment(file.name).sendFile(full);
}));

export default router;
