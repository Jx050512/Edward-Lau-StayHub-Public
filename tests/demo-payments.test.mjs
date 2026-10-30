import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { demoPaymentEligible,demoRefundRequired,demoReceivedCents } from '../netlify/functions/core.mjs';
const root=process.cwd();
const api=readFileSync(resolve(root,'netlify/functions/api.mjs'),'utf8');
const sql=readFileSync(resolve(root,'netlify/database/migrations/20261030020000_demo_payments.sql'),'utf8');
test('simulated payment requires a bookable status and unpaid record',()=>{
 for(const s of ['pending','confirmed'])assert.equal(demoPaymentEligible(s,'unpaid'),true);
 for(const s of ['cancelled','completed'])assert.equal(demoPaymentEligible(s,'unpaid'),false);
 assert.equal(demoPaymentEligible('pending','paid'),false);
 assert.equal(demoPaymentEligible('confirmed','refunded'),false);
});
test('refund and income semantics',()=>{
 assert.equal(demoRefundRequired('paid'),true);
 assert.equal(demoRefundRequired('unpaid'),false);
 assert.equal(demoReceivedCents([{status:'paid',amount_cents:39220},{status:'refunded',amount_cents:170660}]),39220);
});
test('database guarantees one receipt per booking and no raw card data',()=>{
 assert.match(sql,/booking_id BIGINT NOT NULL UNIQUE/);
 assert.match(sql,/CHECK \(method IN \('demo_card','demo_wallet'\)\)/);
 assert.ok(!/card_number|cvv|expiry_date/i.test(sql));
});
test('API authenticates customer and records with transaction and row lock',()=>{
 assert.match(api,/\/demo-pay\$\/\)/);
 assert.match(api,/requiredUser\(db,req\)/);
 assert.match(api,/SELECT \* FROM bookings WHERE id=\$1 AND user_id=\$2 FOR UPDATE/);
 assert.match(api,/demoPaymentEligible\(b\.status/);
 assert.match(api,/Demo payment recorded/);
});
test('both cancellation flows record simulated refunds, metrics exclude refunded',()=>{
 assert.ok((api.match(/SET status='refunded',refunded_at=NOW\(\)/g)||[]).length>=2);
 assert.match(api,/WHERE status='paid'\) AS demo_received_cents/);
 assert.match(api,/status='paid' AND TO_CHAR\(paid_at/);
});
const siblingAdmin=resolve(root,'../Edward Lau_StayHub_Admin/site/assets/admin.js');
test('both frontends present demo status and disclaim no real funds',{skip:!existsSync(siblingAdmin)},()=>{
 const pub=readFileSync(resolve(root,'site/assets/app.js'),'utf8');
 assert.match(pub,/Simulate payment/);
 assert.match(pub,/Do not enter real bank or card information/);
 assert.match(pub,/demoPaymentDialog/);
 assert.match(readFileSync(siblingAdmin,'utf8'),/demo/i);
});
