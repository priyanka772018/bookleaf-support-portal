import { createApp } from './app.js';
import { config } from './config/env.js';
import { pool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';
import { aiHealth, waitForBackgroundJobs } from './services/aiService.js';

async function main() {
  // Keep a fresh deploy usable with zero manual steps.
  if (process.env.AUTO_MIGRATE !== 'false') {
    await migrate();
    if (process.env.AUTO_SEED !== 'false') await seed();
  }
  const server = createApp().listen(config.port, () => {
    const ai = aiHealth();
    console.log(`BookLeaf API listening on :${config.port} (${config.env})`);
    console.log(ai.enabled
      ? `AI: ${ai.provider} / ${ai.model}`
      : 'AI: disabled (no ANTHROPIC_API_KEY) — using keyword triage + policy templates');
  });

  const shutdown = async () => {
    server.close();
    await waitForBackgroundJobs();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => { console.error(err); process.exit(1); });
