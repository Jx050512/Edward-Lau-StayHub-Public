import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=(p)=>readFileSync(resolve(root,p),'utf8');
const exists=(p)=>existsSync(resolve(root,p));
test('Public project bundles API Functions, database migration and frontend',()=>{
 assert.ok(exists('netlify/functions/api.mjs'));
 assert.ok(exists('netlify/functions/core.mjs'));
 assert.ok(exists('netlify/database/migrations/20261029010000_schema.sql'));
 assert.ok(exists('site/index.html'));
});
test('Netlify publishes only the static site directory',()=>{
 assert.match(read('netlify.toml'),/publish\s*=\s*"site"/);
 assert.ok(!exists('site/netlify/functions/api.mjs'));
 assert.ok(!exists('site/ENVIRONMENT_VARIABLES.example'));
});
test('Public uses a same-origin API path',()=>{
 assert.match(read('site/assets/config.js'),/STAYHUB_API_BASE\s*=\s*'\/api'/);
 assert.match(read('netlify/functions/api.mjs'),/config=\{path:'\/api\/\*'\}/);
});
test('API contains server-side admin restrictions and room inventory transaction',()=>{
 const api=read('netlify/functions/api.mjs');
 assert.match(api,/email!==reservedAdmin/);
 assert.match(api,/FOR UPDATE/);
 assert.match(api,/consumeRate/);
 assert.match(api,/STAYHUB_OTP_SECRET/);
});
test('Netlify migration has all essential related tables',()=>{
 const migration=read('netlify/database/migrations/20261029010000_schema.sql');
 for (const table of ['users','properties','room_types','bookings','booking_items','sessions','login_challenges','auth_attempts']) assert.match(migration,new RegExp('CREATE TABLE '+table+'\\b'));
});
