import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/errors.js';
import { listBooks, getBook } from '../services/bookService.js';

const router = Router();
router.use(authenticate, requireRole('author'));

/** GET /api/books → the logged-in author's books + totals */
router.get('/', asyncHandler(async (req, res) => {
  res.json(await listBooks(req.user.authorId));
}));

/** GET /api/books/:bookId → one of the author's books */
router.get('/:bookId', asyncHandler(async (req, res) => {
  res.json({ book: await getBook(req.user.authorId, req.params.bookId) });
}));

export default router;
