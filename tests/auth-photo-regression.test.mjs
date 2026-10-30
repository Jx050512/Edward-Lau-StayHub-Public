import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,existsSync } from 'node:fs';
import {resolve} from 'node:path';
const root=process.cwd();
const api=readFileSync(resolve(root,'netlify/functions/api.mjs'),'utf8');
const seed=readFileSync(resolve(root,'netlify/database/migrations/20261029010100_seed.sql'),'utf8');
test('local demo email code restricted to opt-in Netlify Dev and loopback host',()=>{
 assert.match(api,/process\.env\.CONTEXT==='dev'/);
 assert.match(api,/STAYHUB_LOCAL_DEMO_OTP==='true'/);
 assert.match(api,/host==='localhost'/);
 assert.match(api,/sendOTP\(user\.email,code,req\)/);
});
test('Bintulu broken gallery URL replaced in seed and correction migration available',()=>{
 assert.ok(!seed.includes('photo-1574643156929-51fa098b0394'));
 assert.ok(existsSync(resolve(root,'netlify/database/migrations/20261030010000_photo_url_repair.sql')));
});
test('no real local secrets included in distributed project',()=>{
 const ignore=readFileSync(resolve(root,'.gitignore'),'utf8');
 assert.match(ignore,/^\.env$/m);
 assert.match(ignore,/^node_modules\/$/m);
 assert.ok(existsSync(resolve(root,'scripts/setup-local.mjs')));
 assert.ok(existsSync(resolve(root,'site/assets/photo-unavailable.svg')));
});
