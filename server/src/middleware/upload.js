import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { config } from '../config/env.js';
import { badRequest } from '../utils/errors.js';

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);

fs.mkdirSync(config.uploads.dir, { recursive: true });

/** Single optional attachment, stored on disk under a random name. */
export const ticketAttachment = multer({
  storage: multer.diskStorage({
    destination: config.uploads.dir,
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase().slice(0, 10)}`),
  }),
  limits: { fileSize: config.uploads.maxBytes, files: 1 },
  fileFilter: (_req, file, cb) => (ALLOWED.has(file.mimetype)
    ? cb(null, true)
    : cb(badRequest('Attachment must be an image (PNG/JPG/WebP), PDF, TXT or Word document'))),
}).single('attachment');

export const uploadPath = (filename) => path.resolve(config.uploads.dir, filename);
