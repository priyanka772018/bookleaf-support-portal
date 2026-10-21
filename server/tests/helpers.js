import request from 'supertest';
import { createApp } from '../src/app.js';
import { migrate } from '../src/db/migrate.js';
import { seed, DEMO_ADMIN_PASSWORD, DEMO_AUTHOR_PASSWORD } from '../src/db/seed.js';
import { pool } from '../src/db/pool.js';
import { resetCircuit, setMockHandler } from '../src/ai/provider.js';

export const app = createApp();
export const api = () => request(app);

export async function resetDb() {
  await migrate({ log: () => {} });
  await pool.query('TRUNCATE tickets, ai_calls RESTART IDENTITY CASCADE');
  await seed({ demoTickets: false, log: () => {} });
  resetCircuit();
  setMockHandler(null);
}

export async function login(email, password) {
  const res = await api().post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  return res.body.token;
}
export const loginAuthor = (email) => login(email, DEMO_AUTHOR_PASSWORD);
export const loginAdmin = () => login('admin@bookleaf.com', DEMO_ADMIN_PASSWORD);

/** Default mock: sensible classify + draft outputs, recording every request. */
export function installMock(overrides = {}) {
  const calls = [];
  setMockHandler(async ({ purpose, request: req }) => {
    calls.push({ purpose, req });
    if (overrides[purpose]) return overrides[purpose](req);
    if (purpose === 'classify') return { category: 'royalty_payments', priority: 'critical', confidence: 0.92, reasoning: 'Author reports months of unpaid royalties.' };
    return { reply: 'Hi Ananya,\n\nThank you for flagging this. Your ₹2,546 is overdue and we have escalated it.\n\nWarm regards,\nBookLeaf Author Support', admin_checklist: ['Confirm bank details are linked'] };
  });
  return calls;
}

export { pool };
