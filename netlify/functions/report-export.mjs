/* StayHub privacy-safe report exports. Never export authentication secrets or raw guest contacts.
 * Invoked ONLY AFTER the API has verified a current MFA-protected admin session.
 */
import { HttpError } from './core.mjs';

const MAX_EXPORT_ROWS = 5000;
const money = cents => Math.round(Number(cents || 0)) / 100;
const day = v => v ? (v instanceof Date ? v.toISOString().slice(0,10) : String(v).slice(0,10)) : '';
const stamp = v => v ? (v instanceof Date ? v.toISOString() : new Date(v).toISOString()) : '';
const safeText = v => {
 const text = String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,' ');
 // Spreadsheet editors may interpret leading formula symbols as executable formulas.
 return /^[\s]*[=+@\-\t\r]/.test(text) ? "'" + text : text;
};
export function maskEmail(email){
 const match=String(email||'').trim().toLowerCase().match(/^([^@]+)@([^@]+)$/);
 if(!match)return '[hidden]';
 const local=match[1],domain=match[2],dot=domain.lastIndexOf('.');
 const host=dot>0?domain.slice(0,dot):domain;
 const tld=dot>0?domain.slice(dot):'';
 return local.slice(0,Math.min(2,local.length))+'***@'+host.slice(0,1)+'***'+tld;
}
export function maskName(value){
 const parts=String(value||'').trim().split(/\s+/).filter(Boolean);
 return parts.length?parts.map(p=>p.slice(0,1)+'***').join(' '):'[hidden]';
}
function dataset(name,columns,rows,description){return {name,columns,rows,description};}
const column=(header,key,type='text')=>({header,key,type});
export const reportNames=['summary','customers','bookings','payments','properties','rooms'];

const queries = {
 summary: `SELECT
  (SELECT COUNT(*)::integer FROM properties WHERE active=TRUE) AS active_properties,
  (SELECT COUNT(*)::integer FROM room_types WHERE active=TRUE) AS active_room_types,
  (SELECT COUNT(*)::integer FROM users WHERE role='customer') AS registered_customers,
  (SELECT COUNT(*)::integer FROM bookings) AS total_bookings,
  (SELECT COUNT(*)::integer FROM bookings WHERE status='pending') AS pending_bookings,
  (SELECT COUNT(*)::integer FROM bookings WHERE status='confirmed') AS confirmed_bookings,
  (SELECT COUNT(*)::integer FROM bookings WHERE status='completed') AS completed_bookings,
  (SELECT COUNT(*)::integer FROM bookings WHERE status='cancelled') AS cancelled_bookings,
  (SELECT COALESCE(SUM(total_cents),0)::bigint FROM bookings WHERE status IN ('pending','confirmed','completed')) AS active_reservation_cents,
  (SELECT COALESCE(SUM(amount_cents),0)::bigint FROM demo_payments WHERE status='paid') AS demo_paid_cents,
  (SELECT COALESCE(SUM(amount_cents),0)::bigint FROM demo_payments WHERE status='refunded') AS demo_refunded_cents`,
 customers: `SELECT u.id,u.name,u.email,u.email_verified,u.active,u.created_at,
  COUNT(b.id)::integer AS booking_count,
  COUNT(b.id) FILTER (WHERE b.status IN ('pending','confirmed'))::integer AS open_bookings
  FROM users u LEFT JOIN bookings b ON b.user_id=u.id WHERE u.role='customer'
  GROUP BY u.id ORDER BY u.id LIMIT 5001`,
 bookings: `SELECT b.id,b.user_id,u.name AS customer_name,u.email AS customer_email,
  p.name AS property_name,p.city,b.check_in,b.check_out,b.guests,b.status,b.created_at,
  b.subtotal_cents,b.service_fee_cents,b.total_cents,b.service_fee_percent,
  COALESCE(items.units,0)::integer AS booked_rooms,
  COALESCE(pay.status,'unpaid') AS payment_status
  FROM bookings b JOIN users u ON u.id=b.user_id JOIN properties p ON p.id=b.property_id
  LEFT JOIN (SELECT booking_id,SUM(quantity)::integer AS units FROM booking_items GROUP BY booking_id) items ON items.booking_id=b.id
  LEFT JOIN demo_payments pay ON pay.booking_id=b.id
  ORDER BY b.id DESC LIMIT 5001`,
 payments: `SELECT dp.id,dp.booking_id,b.user_id,u.name AS customer_name,u.email AS customer_email,
  p.name AS property_name,dp.reference,dp.method,dp.amount_cents,dp.status,dp.paid_at,dp.refunded_at
  FROM demo_payments dp JOIN bookings b ON b.id=dp.booking_id JOIN users u ON u.id=b.user_id
  JOIN properties p ON p.id=b.property_id ORDER BY dp.id DESC LIMIT 5001`,
 properties: `SELECT id,name,city,category,featured,active,created_at FROM properties ORDER BY id LIMIT 5001`,
 rooms: `SELECT r.id,r.property_id,p.name AS property_name,r.name,r.price,r.capacity,r.units,r.active
  FROM room_types r JOIN properties p ON p.id=r.property_id ORDER BY r.property_id,r.id LIMIT 5001`
};
export function reportTable(name,raw){
 const rows=raw||[];
 if(rows.length>MAX_EXPORT_ROWS)throw new HttpError(413,'More than 5000 records. Narrow the database before exporting.');
 if(name==='summary'){
  const v=rows[0]||{};
  return dataset('Summary',[column('Metric','metric'),column('Value','value'),column('Notes','note')],[
   {metric:'Generated at (UTC)',value:new Date().toISOString(),note:'Admin-only report snapshot'},
   {metric:'Report type',value:'Privacy-safe database report',note:'Not a SQL backup'},
   {metric:'Active properties',value:Number(v.active_properties||0),note:''},
   {metric:'Active room types',value:Number(v.active_room_types||0),note:''},
   {metric:'Registered customers',value:Number(v.registered_customers||0),note:'Customer accounts only'},
   {metric:'Total reservations',value:Number(v.total_bookings||0),note:''},
   {metric:'Pending reservations',value:Number(v.pending_bookings||0),note:''},
   {metric:'Confirmed reservations',value:Number(v.confirmed_bookings||0),note:''},
   {metric:'Completed reservations',value:Number(v.completed_bookings||0),note:''},
   {metric:'Cancelled reservations',value:Number(v.cancelled_bookings||0),note:''},
   {metric:'Active reservation value (RM)',value:money(v.active_reservation_cents),note:'Not collected money'},
   {metric:'Demo payment currently paid (RM)',value:money(v.demo_paid_cents),note:'Simulated — no real funds'},
   {metric:'Demo payments refunded (RM)',value:money(v.demo_refunded_cents),note:'Simulated — no real funds'},
  ],'Simulated finances, never real revenue.');
 }
 if(name==='customers')return dataset('Customers',[
  column('Customer ID','customer_id','number'),column('Customer name (masked)','customer_name'),
  column('Email (masked)','email'),column('Email verified','email_verified'),column('Account status','status'),
  column('Reservations','bookings','number'),column('Open reservations','open_bookings','number'),column('Registered (UTC)','registered')
 ],rows.map(r=>({customer_id:Number(r.id),customer_name:maskName(r.name),email:maskEmail(r.email),email_verified:!!r.email_verified?'Yes':'No',status:r.active?'Active':'Inactive',bookings:Number(r.booking_count),open_bookings:Number(r.open_bookings),registered:stamp(r.created_at)})),'Customer names and emails masked; no passwords, OTPs, tokens or phone numbers.');
 if(name==='bookings')return dataset('Bookings',[
  column('Booking ID','booking_id','number'),column('Customer ID','customer_id','number'),column('Guest (masked)','guest'),
  column('Email (masked)','email'),column('Property','property'),column('City','city'),column('Check-in','check_in'),
  column('Check-out','check_out'),column('Guests','guests','number'),column('Rooms','rooms','number'),
  column('Subtotal (RM)','subtotal','money'),column('Service fee (RM)','fee','money'),column('Total (RM)','total','money'),
  column('Service fee %','fee_percent','number'),column('Reservation status','status'),column('Demo payment status','payment_status'),column('Created (UTC)','created')
 ],rows.map(r=>({booking_id:Number(r.id),customer_id:Number(r.user_id),guest:maskName(r.customer_name),email:maskEmail(r.customer_email),property:r.property_name,city:r.city,check_in:day(r.check_in),check_out:day(r.check_out),guests:Number(r.guests),rooms:Number(r.booked_rooms),subtotal:money(r.subtotal_cents),fee:money(r.service_fee_cents),total:money(r.total_cents),fee_percent:Number(r.service_fee_percent||0),status:r.status,payment_status:r.payment_status,created:stamp(r.created_at)})),'Amounts represent reservations, not cash collected.');
 if(name==='payments')return dataset('Demo Payments',[
  column('Payment ID','payment_id','number'),column('Booking ID','booking_id','number'),column('Customer ID','customer_id','number'),
  column('Guest (masked)','guest'),column('Email (masked)','email'),column('Property','property'),column('Demo reference','reference'),
  column('Demo method','method'),column('Amount (RM)','amount','money'),column('Status','status'),
  column('Simulated payment (UTC)','paid_at'),column('Simulated refund (UTC)','refunded_at'),column('Real money collected','real_money')
 ],rows.map(r=>({payment_id:Number(r.id),booking_id:Number(r.booking_id),customer_id:Number(r.user_id),guest:maskName(r.customer_name),email:maskEmail(r.customer_email),property:r.property_name,reference:r.reference,method:r.method,amount:money(r.amount_cents),status:r.status,paid_at:stamp(r.paid_at),refunded_at:stamp(r.refunded_at),real_money:'No — simulation only'})),'All transactions are simulated. No real cards, banks or payments.');
 if(name==='properties')return dataset('Properties',[
  column('Property ID','id','number'),column('Name','name'),column('City','city'),column('Category','category'),
  column('Featured','featured'),column('Status','status'),column('Created (UTC)','created')
 ],rows.map(r=>({id:Number(r.id),name:r.name,city:r.city,category:r.category,featured:r.featured?'Yes':'No',status:r.active?'Active':'Archived',created:stamp(r.created_at)})),'Public-facing property information.');
 if(name==='rooms')return dataset('Room Inventory',[
  column('Room ID','id','number'),column('Property ID','property_id','number'),column('Property','property'),
  column('Room type','name'),column('Nightly price (RM)','price','money'),column('Guests / room','capacity','number'),
  column('Units','units','number'),column('Status','status')
 ],rows.map(r=>({id:Number(r.id),property_id:Number(r.property_id),property:r.property_name,name:r.name,price:Number(r.price),capacity:Number(r.capacity),units:Number(r.units),status:r.active?'Active':'Inactive'})),'Inventory snapshot; availability varies by date.');
 throw new HttpError(400,'Unsupported report type.');
}
export async function loadReportTables(db,datasetName){
 if(datasetName!=='all'&&!reportNames.includes(datasetName))throw new HttpError(400,'Invalid report category.');
 const names=datasetName==='all'?reportNames:[datasetName],results=[];
 for(const name of names){const rows=(await db.query(queries[name])).rows;results.push(reportTable(name,rows));}
 return results;
}
export function tableCSV(table){
 const stringify=v=>{const s=typeof v==='number'?String(v):safeText(v);return '"'+s.replace(/"/g,'""')+'"';};
 const header=table.columns.map(c=>stringify(c.header)).join(',');
 const lines=table.rows.map(r=>table.columns.map(c=>stringify(r[c.key])).join(','));
 return '\uFEFF'+[header,...lines].join('\r\n')+'\r\n';
}
// Generates a real XLSX workbook using Office Open XML, with no extra npm dependencies.
// The renderer uses typed numeric cells, escaped inline strings and no formulas.
import {xlsxWorkbook} from './xlsx-lite.mjs';
export async function workbookXLSX(tables){return xlsxWorkbook(tables,{safeText});}
export async function exportReport(db,{format,datasetName}){
 if(!['csv','xlsx'].includes(format))throw new HttpError(400,'Use CSV or Excel format.');
 if(format==='csv'&&datasetName==='all')throw new HttpError(400,'For all reports, use Excel; CSV exports one category at a time.');
 const tables=await loadReportTables(db,datasetName);
 const date=new Date().toISOString().slice(0,10),name=datasetName==='all'?'complete':datasetName;
 const file=`StayHub_${name}_${date}.${format}`;
 const content=format==='csv'?tableCSV(tables[0]):await workbookXLSX(tables);
 const type=format==='csv'?'text/csv; charset=utf-8':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
 return new Response(content,{status:200,headers:{
  'Content-Type':type,'Content-Disposition':`attachment; filename="${file}"`,
  'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','X-Content-Type-Options':'nosniff',
  'Content-Security-Policy':"default-src 'none'; sandbox"
 }});
}
