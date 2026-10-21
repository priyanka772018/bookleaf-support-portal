/**
 * GET /api/events — Server-Sent Events stream of ticket changes.
 * Authors receive events only for their own tickets; admins receive all.
 * The client reads this with fetch() so the JWT travels in the Authorization
 * header rather than in the URL.
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { subscribe } from '../services/events.js';

const router = Router();

router.get('/', authenticate, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable proxy buffering (nginx/Render)
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  res.write(`event: ready\ndata: ${JSON.stringify({ role: req.user.role })}\n\n`);

  const { role, authorId } = req.user;
  const unsubscribe = subscribe((evt) => {
    const allowed = role === 'admin'
      ? evt.toAdmins
      : evt.toAuthor && evt.payload.authorId === authorId;
    if (!allowed) return;
    res.write(`event: ${evt.type}\ndata: ${JSON.stringify({ ...evt.payload, at: evt.at })}\n\n`);
  });

  // Heartbeat keeps idle connections alive through proxies.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
});

export default router;
