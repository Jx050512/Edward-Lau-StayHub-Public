import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const paths = [
  'site/index.html',
  'site/assets/app.js',
  'site/assets/site.css',
  'site/assets/stayhub-artistic-wordmark.png',
  'netlify.toml',
  'netlify/functions/api.mjs',
  'netlify/functions/core.mjs',
  'netlify/database/migrations/20261029010000_schema.sql',
  'netlify/database/migrations/20261029010100_seed.sql',
  'netlify/database/migrations/20261030010000_photo_url_repair.sql',
  'netlify/database/migrations/20261030020000_demo_payments.sql'
];
console.log('\nStayHub V15.4 / project directory: ' + root + '\n');
let missing = 0;
for (const p of paths) {
  const ok = existsSync(resolve(root,p));
  console.log(`${ok ? '[OK]' : '[MISSING]'} ${p}`);
  if (!ok) missing++;
}
const conf = readFileSync(resolve(root,'netlify.toml'),'utf8');
for (const required of ['framework = "#static"','publish = "site"','path = "netlify/database/migrations"']) {
  const ok = conf.includes(required);
  console.log(`${ok ? '[OK]' : '[CONFIG ERROR]'} ${required}`);
  if (!ok) missing++;
}
if (missing) { console.error('\nRequired files are missing or the configuration is invalid. Please re-extract the FULL ZIP.'); process.exitCode = 1; }
else console.log('\nProject structure: PASS. This does NOT yet confirm database connectivity.');
