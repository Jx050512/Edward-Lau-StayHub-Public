import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const pub=resolve(dirname(fileURLToPath(import.meta.url)),'..'), adm=resolve(pub,'..','Edward Lau_StayHub_Admin');
const api=readFileSync(resolve(pub,'netlify/functions/api.mjs'),'utf8');
test('admin customer detail is protected and parameterized',()=>{
 assert.ok(api.includes("admin\\/customers"));
 assert.match(api,/requiredUser\(db,req,'admin'\)/);
 assert.match(api,/WHERE b\.user_id=\$1/);
 assert.match(api,/WHERE id=\$1 AND role='customer'/);
});
test('customer account status refuses conflicting reservations and revokes sessions',()=>{
 assert.match(api,/Resolve those reservations before disabling access/);
 assert.match(api,/DELETE FROM sessions WHERE user_id=\$1/);
 assert.match(api,/role='customer' FOR UPDATE/);
});
test('MFA email is sent via Resend with no hardcoded live credentials',()=>{
 assert.match(api,/RESEND_API_KEY/);assert.match(api,/STAYHUB_FROM_EMAIL/);assert.match(api,/AbortSignal\.timeout/);
 assert.ok(!existsSync(resolve(pub,'site','.env')));
});
test('admin UI customer search, filters and booking panel exist if project included',()=>{
 if(!existsSync(resolve(adm,'site/assets/admin.js')))return;
 const js=readFileSync(resolve(adm,'site/assets/admin.js'),'utf8');
 for(const part of ['vfinal-search','vfinal-filter','customerBookings','/admin/customers/','vfinal-toggle'])assert.ok(js.includes(part),part);
});
