import { randomBytes } from 'node:crypto';
import { writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const target=resolve(root,'.env');
try { await access(target); console.log('Existing .env detected. It was not overwritten.');process.exit(0); } catch {}
const rl=createInterface({input,output});
let email='';
try { email=(await rl.question('Administrator email for LOCAL testing (choose a different address from customer): ')).trim().toLowerCase(); }
finally { rl.close(); }
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {console.error('A valid administrator email is required. Nothing saved.');process.exit(1);}
const password=randomBytes(24).toString('base64url')+'Aa1!';
const secret=randomBytes(48).toString('hex');
const from=(value)=>value.replaceAll('\\','\\\\').replaceAll('"','\\"');
const text=[
 '# PRIVATE LOCAL DEVELOPMENT ONLY. DO NOT UPLOAD OR COMMIT THIS FILE.',
 'STAYHUB_LOCAL_DEMO_OTP=true',
 `STAYHUB_OTP_SECRET=${secret}`,
 `STAYHUB_ADMIN_EMAIL=${email}`,
 `STAYHUB_ADMIN_PASSWORD=${password}`,
 ''].join('\n');
await writeFile(target,text,{mode:0o600,flag:'wx'});
console.log('\nLocal configuration created in the Public project .env');
console.log('LOCAL ADMIN EMAIL: '+email);
console.log('LOCAL ADMIN PASSWORD (save privately): '+password);
console.log('\nCodes for local MFA will be printed in the NETLIFY DEV terminal only.');
console.log('Do not share the password, .env file, or MFA code.');
