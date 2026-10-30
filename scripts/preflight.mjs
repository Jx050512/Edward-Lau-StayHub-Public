import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const get=(path)=>readFileSync(resolve(root,path),'utf8');
const required=['site/index.html','site/assets/app.js','netlify/functions/api.mjs','netlify/functions/core.mjs','netlify.toml','package.json','netlify/database/migrations/20261029010000_schema.sql','netlify/database/migrations/20261029010100_seed.sql','netlify/database/migrations/20261030010000_photo_url_repair.sql','netlify/database/migrations/20261030020000_demo_payments.sql'];
let failed=false;
for(const file of required){const ok=existsSync(resolve(root,file));console.log(`${ok?'[OK]':'[MISSING]'} ${file}`);if(!ok)failed=true;}
const toml=get('netlify.toml');if(!/publish\s*=\s*"site"/.test(toml)||!/functions\s*=\s*"netlify\/functions"/.test(toml)){console.log('[ERROR] Netlify build must publish site/ and source Functions from netlify/functions.');failed=true;}
for(const forbidden of ['site/.env','site/netlify/functions/api.mjs','site/package.json'])if(existsSync(resolve(root,forbidden))){console.log('[ERROR] Sensitive code within published site:',forbidden);failed=true;}
console.log('\nReminder: set private Runtime environment variables in NETLIFY UI, not in this repository.');
console.log('Required for real email OTP: STAYHUB_ADMIN_EMAIL, STAYHUB_ADMIN_PASSWORD (bootstrap only), STAYHUB_OTP_SECRET (32+ chars), RESEND_API_KEY, STAYHUB_FROM_EMAIL (verified sender domain).');
console.log('STAYHUB_LOCAL_DEMO_OTP must NOT be enabled in production.');
if(failed)process.exit(1);
