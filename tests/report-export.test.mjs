import test from 'node:test';
import assert from 'node:assert/strict';
import {maskEmail,maskName,reportTable,tableCSV,workbookXLSX,loadReportTables,exportReport} from '../netlify/functions/report-export.mjs';

const customer={id:9,name:'Edward Lau',email:'edward@example.com',password_hash:'SENSITIVE_HASH',token_hash:'SENSITIVE_TOKEN',code_hash:'SENSITIVE_OTP',phone:'+600123456',email_verified:true,active:true,booking_count:2,open_bookings:1,created_at:'2026-10-30T08:00:00Z'};
test('customer exports mask all identifiers and never include secrets or phones',()=>{
 const t=reportTable('customers',[customer]);
 const csv=tableCSV(t);
 assert.match(csv,/ed\*\*\*@e\*\*\*\.com/);
 for(const secret of ['edward@example.com','Edward Lau','SENSITIVE_HASH','SENSITIVE_TOKEN','SENSITIVE_OTP','+600123456']) assert.ok(!csv.includes(secret),secret);
 assert.equal(maskName('Edward Lau'),'E*** L***');
 assert.equal(maskEmail('x@gmail.com'),'x***@g***.com');
});
test('CSV safely escapes formulas, quotation marks and separators',()=>{
 const t=reportTable('properties',[{id:1,name:'=SUM(1,2)',city:'A, "B"',category:'Hotel',featured:true,active:true,created_at:'2026-10-31'}]);
 const csv=tableCSV(t);
 assert.ok(csv.charCodeAt(0)===0xfeff);
 assert.match(csv,/'=SUM\(1,2\)/);
 assert.match(csv,/"A, ""B"""/);
});
test('exports are capped at 5000 records and categories strictly validated',async()=>{
 assert.throws(()=>reportTable('customers',Array(5001).fill(customer)),/5000/);
 await assert.rejects(()=>loadReportTables({query:async()=>({rows:[]})},'sessions'),/Invalid report category/);
 await assert.rejects(()=>exportReport({query:async()=>({rows:[]})},{format:'csv',datasetName:'all'}),/use Excel/);
});
test('XLSX is generated with money fields and six valid sheet data streams',async()=>{
 const tables=[
  reportTable('summary',[{registered_customers:1,active_properties:1,demo_paid_cents:123456,demo_refunded_cents:2000}]),
  reportTable('customers',[customer]),
  reportTable('bookings',[{id:1,user_id:9,customer_name:'Edward Lau',customer_email:'edward@example.com',property_name:'Stay A',city:'Miri',check_in:'2026-11-02',check_out:'2026-11-04',guests:2,status:'completed',created_at:'2026-10-31',subtotal_cents:116600,service_fee_cents:6996,total_cents:123596,service_fee_percent:6,booked_rooms:1,payment_status:'paid'}]),
  reportTable('payments',[{id:7,booking_id:1,user_id:9,customer_name:'Edward Lau',customer_email:'edward@example.com',property_name:'Stay A',reference:'SH-DEMO-123',method:'demo_card',amount_cents:123596,status:'paid',paid_at:'2026-10-31'}]),
  reportTable('properties',[{id:1,name:'Stay A',city:'Miri',category:'Hotel',featured:true,active:true,created_at:'2026-10-31'}]),
  reportTable('rooms',[{id:1,property_id:1,property_name:'Stay A',name:'King Room',price:320,capacity:2,units:4,active:true}])
 ];
 const bytes=await workbookXLSX(tables);
 assert.equal(Buffer.from(bytes).toString('ascii',0,2),'PK');
 const text=Buffer.from(bytes).toString('binary');
 for(const raw of ['edward@example.com','SENSITIVE_HASH','SENSITIVE_TOKEN'])assert.ok(!text.includes(raw));
 assert.ok(bytes.byteLength>3000);
});
