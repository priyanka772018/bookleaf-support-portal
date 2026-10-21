import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { forbidden, unauthorized } from '../utils/errors.js';

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, authorId: user.author_id ?? null, name: user.name, email: user.email },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  );
}

/** Verifies the Bearer token and attaches `req.user`. */
export function authenticate(req, _res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(unauthorized());
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = { id: payload.sub, role: payload.role, authorId: payload.authorId, name: payload.name, email: payload.email };
    return next();
  } catch (err) {
    return next(unauthorized(err.name === 'TokenExpiredError' ? 'Session expired, please log in again' : 'Invalid token'));
  }
}

/** Role gate — use after `authenticate`. */
export const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user?.role) ? next() : next(forbidden());
