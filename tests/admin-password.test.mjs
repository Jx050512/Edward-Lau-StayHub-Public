import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {passwordHash,passwordVerify} from '../netlify/functions/core.mjs';
import {strongAdminPassword,localDatabaseOnly,changeAdminPassword,resetLocalAdminPassword} from '../netlify/functions/admin-password.mjs';
const secure='SampleOnly!2026X';
function dbMock(role='admin'){
 const state={user:{id:7,email:'admin@example.test',role,active:true,password_hash:passwordHash('Original!2026')},customers:[{id:9}],bookings:[{id:44}],sessions:[{user_id:7},{user_id:9}],challenges:[{user_id:7}],operations:[]};
 return {state,async query(sql,params=[]){state.operations.push(sql);
   if(sql.startsWith('SELECT password_hash FROM users'))return {rows:role==='admin'?[{password_hash:state.user.password_hash}]:[]};
   if(sql.startsWith('SELECT id,password_hash FROM users'))return {rows:role==='admin'?[{id:7,password_hash:state.user.password_hash}]:[]};
   if(sql.startsWith('UPDATE users SET password_hash')){state.user.password_hash=params[0];return {rows:[]};}
   if(sql.startsWith('DELETE FROM sessions'))state.sessions=state.sessions.filter(s=>s.user_id!==params[0]);
   if(sql.startsWith('DELETE FROM login_challenges'))state.challenges=state.challenges.filter(s=>s.user_id!==params[0]);
   return {rows:[]};
 }};
}
test('admin password requires strong distinct password',()=>{
 assert.equal(strongAdminPassword('Weak123!'),false);
 assert.equal(strongAdminPassword('ONLYUPPERCASE123!'),false);
 assert.equal(strongAdminPassword(secure),true);
 assert.equal(strongAdminPassword('x'.repeat(129)),false);
});
test('password change checks current password, rotates hash and revokes only admin sessions',async()=>{
 const db=dbMock();
 await changeAdminPassword(db,7,'Original!2026',secure);
 assert.ok(passwordVerify(secure,db.state.user.password_hash));
 assert.ok(!passwordVerify('Original!2026',db.state.user.password_hash));
 assert.deepEqual(db.state.sessions,[{user_id:9}]);
 assert.deepEqual(db.state.challenges,[]);
 assert.deepEqual(db.state.customers,[{id:9}]);assert.deepEqual(db.state.bookings,[{id:44}]);
 assert.equal(db.state.operations.at(-1),'COMMIT');
});
test('wrong current password and reused password are denied without change',async()=>{
 const d=dbMock();const before=d.state.user.password_hash;
 await assert.rejects(()=>changeAdminPassword(d,7,'NotCurrent!123',secure),/Current password is incorrect/);
 assert.equal(d.state.user.password_hash,before);
 assert.equal(d.state.operations.at(-1),'ROLLBACK');
 await assert.rejects(()=>changeAdminPassword(d,7,'Original!2026','Original!2026'),/different/);
});
test('only administrators can change password',async()=>{
 const d=dbMock('customer');await assert.rejects(()=>changeAdminPassword(d,7,'Original!2026',secure),/Administrator access required/);
});
test('local reset refuses production/remote DB and preserves customers and bookings',async()=>{
 assert.equal(localDatabaseOnly('production','postgresql://user:x@localhost:5432/db'),false);
 assert.equal(localDatabaseOnly('dev','postgresql://user:x@database.example.com/db'),false);
 assert.equal(localDatabaseOnly('dev','postgresql://user:x@127.0.0.1:5432/db'),true);
 const d=dbMock();await resetLocalAdminPassword(d,'admin@example.test',secure);
 assert.ok(passwordVerify(secure,d.state.user.password_hash));
 assert.equal(d.state.bookings.length,1);assert.equal(d.state.customers.length,1);
});
const siblingAdmin=resolve('../Edward Lau_StayHub_Admin/site/assets/admin.js');
test('Admin settings UI, API auth boundary and CLI scripts are wired',{skip:!existsSync(siblingAdmin)},()=>{
 const api=readFileSync(resolve('netlify/functions/api.mjs'),'utf8');
 const adm=readFileSync(siblingAdmin,'utf8');
 const script=readFileSync(resolve('scripts/reset-admin-password.mjs'),'utf8');
 assert.match(api,/requiredUser\(db,req,'admin'\)/);
 assert.match(api,/\/api\/admin\/change-password/);
 assert.match(adm,/Change administrator password/);
 assert.match(adm,/current_password/);
 assert.match(adm,/new_password/);
 assert.match(script,/localDatabaseOnly/);
 assert.ok(!script.includes('process.argv[2]'));
});
