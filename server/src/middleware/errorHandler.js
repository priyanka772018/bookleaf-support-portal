import multer from 'multer';
import { AppError } from '../utils/errors.js';
import { config } from '../config/env.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.originalUrl}` } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Attachment exceeds the 5 MB limit' : err.message;
    return res.status(400).json({ error: { code: 'INVALID_ATTACHMENT', message } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
  }
  // Postgres constraint violations → 4xx rather than opaque 500s.
  if (err.code === '23503') return res.status(400).json({ error: { code: 'INVALID_REFERENCE', message: 'Referenced record does not exist' } });
  if (err.code === '23505') return res.status(409).json({ error: { code: 'CONFLICT', message: 'Record already exists' } });
  if (err.code === '22P02') return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Malformed identifier' } });

  if (!config.isTest) console.error(`[${req.method} ${req.originalUrl}]`, err);
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side. Please try again.' } });
}
