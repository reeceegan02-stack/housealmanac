// Runs inside Workers Builds (via wrangler's custom build step) and copies the API keys
// Reece stores as *build* secrets into the Worker's *runtime* secrets. The values never
// leave Cloudflare and are never printed. Locally (no WORKERS_CI) it does nothing.
// To rotate a key: change it under Settings -> Build -> Variables and secrets, then
// "Retry build" (or push any commit).
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const NAMES = [
  'ANTHROPIC_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'PRODIGI_API_KEY',
  'ETSY_KEYSTRING', 'ETSY_SHARED_SECRET',
];

if (!process.env.WORKERS_CI) {
  console.log('sync-secrets: not running in Workers Builds, skipped');
  process.exit(0);
}
// Exact name first; otherwise accept a build secret whose name starts with it
// (e.g. a name pasted twice: STRIPE_WEBHOOK_SECRETSTRIPE_WEBHOOK_SECRET).
const valueFor = (n) => {
  const exact = (process.env[n] || '').trim();
  if (exact) return exact;
  const k = Object.keys(process.env).find((key) => key.startsWith(n) && (process.env[key] || '').trim());
  return k ? process.env[k].trim() : '';
};
const present = NAMES.filter((n) => valueFor(n));
if (!present.length) {
  console.log('sync-secrets: no build secrets set, skipped');
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), 'ha-'));
const file = join(dir, 'secrets.json');
try {
  writeFileSync(file, JSON.stringify(Object.fromEntries(present.map((n) => [n, valueFor(n)]))), { mode: 0o600 });
  execFileSync('npx', ['wrangler', 'secret', 'bulk', file], { stdio: ['ignore', 'ignore', 'pipe'] });
  console.log('sync-secrets: updated ' + present.join(', '));
} catch (e) {
  // Don't block the deploy; the worker reports missing keys on /health.
  console.log('sync-secrets: FAILED (' + String(e.stderr || e.message).replace(/[A-Za-z0-9_\-]{24,}/g, '***').slice(0, 300) + ')');
} finally {
  try { unlinkSync(file); } catch {}
}
