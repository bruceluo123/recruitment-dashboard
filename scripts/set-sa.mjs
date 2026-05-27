import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/set-sa.mjs <json-path>'); process.exit(1); }

const raw = readFileSync(file, 'utf-8');
const parsed = JSON.parse(raw);
if (parsed.type !== 'service_account') { console.error('Not a service_account JSON'); process.exit(1); }

const value = JSON.stringify(parsed);
console.log(`Setting GOOGLE_SERVICE_ACCOUNT for: ${parsed.client_email}`);

execFileSync('npx', ['vercel', 'env', 'add', 'GOOGLE_SERVICE_ACCOUNT', 'production', '--yes'], {
  input: value,
  stdio: ['pipe', 'inherit', 'inherit'],
  shell: false,
});

console.log('Done! Now run: npx vercel deploy --prod --yes');
