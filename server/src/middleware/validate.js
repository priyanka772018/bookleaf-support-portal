import { badRequest } from '../utils/errors.js';

/**
 * Validates req[source] against a zod schema and replaces it with the parsed
 * (coerced, defaulted, stripped) value. Errors list every failing field.
 */
export const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join('.') || source, message: i.message }));
    return next(badRequest('Validation failed', details));
  }
  // req.query is a getter in Express 5; store parsed values separately to be safe.
  if (source === 'query') req.validatedQuery = result.data;
  else req[source] = result.data;
  return next();
};
