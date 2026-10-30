import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cfg=readFileSync(resolve(root, 'netlify.toml'),'utf8');
test('local dev publishes site and enables local database migrations',()=>{
 assert.match(cfg, /\[dev\][\s\S]*?framework\s*=\s*"#static"/);
 assert.match(cfg, /\[dev\][\s\S]*?publish\s*=\s*"site"/);
 assert.match(cfg, /\[db\.migrations\][\s\S]*?path\s*=\s*"netlify\/database\/migrations"/);
});
test('database migration SQL files exist and are not published to public HTML',()=>{
 for(const path of ['20261029010000_schema.sql','20261029010100_seed.sql']){
   assert.ok(existsSync(resolve(root,'netlify/database/migrations',path)));
   assert.ok(!existsSync(resolve(root,'site/netlify/database/migrations',path)));
 }
});
