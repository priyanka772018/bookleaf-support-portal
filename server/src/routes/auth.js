import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { query } from '../db/pool.js';
import { authenticate, signToken } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { loginSchema } from '../validators/schemas.js';
import { asyncHandler, unauthorized } from '../utils/errors.js';
import { config } from '../config/env.js';

const router = Router();

// Brute-force protection on login only.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isTest ? 1000 : 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many login attempts. Please try again in a few minutes.' } },
});

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, authorId: u.author_id ?? null });

/** POST /api/auth/login → { token, user } */
router.post('/login', loginLimiter, validate(loginSchema), asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const { rows: [user] } = await query('SELECT * FROM users WHERE email = $1', [email]);
  // Same error for unknown email and wrong password (no account enumeration).
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw unauthorized('Incorrect email or password');
  }
  res.json({ token: signToken(user), user: publicUser(user) });
}));

/** GET /api/auth/me → current user */
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const { rows: [user] } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!user) throw unauthorized('Account no longer exists');
  res.json({ user: publicUser(user) });
}));

export default router;
