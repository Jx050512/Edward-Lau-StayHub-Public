/* StayHub current — Public Netlify Functions + transactional PostgreSQL + Blobs.
 * Public handles same-origin /api/*; Admin proxies /api/* to Public.
 * All room availability and money totals are calculated server-side.
 */
import pg from 'pg';
import {changeAdminPassword} from './admin-password.mjs';
import { getConnectionString } from '@netlify/database';
import { getStore } from '@netlify/blobs';
import { randomInt, randomBytes } from 'node:crypto';
import { HttpError, sha256, randomToken, toInt, dates, validEmail, validPassword,
  passwordHash, passwordVerify, otpHash, secureEqual, validImageUrl,
  calculation, propertyInput, roomInput, demoPaymentEligible, demoRefundRequired } from './core.mjs';

let pool;
function database(){
 if(!pool){const connectionString=process.env.NETLIFY_DB_URL||getConnectionString();pool=new pg.Pool({connectionString,max:3,connectionTimeoutMillis:12000,idleTimeoutMillis:5000});}
 return pool;
}
const query=async(c,s,p=[]) =>(await c.query(s,p)).rows;
const one=async(c,s,p=[]) =>(await query(c,s,p))[0]||null;
const array=x=>Array.isArray(x)?x:[];
const nowSec=()=>Math.floor(Date.now()/1000);
const isoDate=value=>value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);
const baseHeaders={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer'};
const allowedOrigins=()=>[process.env.STAYHUB_PUBLIC_ORIGIN,process.env.STAYHUB_ADMIN_ORIGIN].filter(Boolean).map(x=>x.replace(/\/$/,''));
function response(payload,status=200,origin=''){
 const headers={...baseHeaders,'Content-Type':'application/json; charset=utf-8'};
 if(origin&&allowedOrigins().includes(origin)){headers['Access-Control-Allow-Origin']=origin;headers.Vary='Origin';}
 return new Response(JSON.stringify(payload),{status,headers});
}
const must=(condition,status,msg)=>{if(!condition)throw new HttpError(status,msg);};
function userJSON(row){return {id:Number(row.id),name:row.name,email:row.email,role:row.role};}
function propertyJSON(p,photos=[],rooms=[]){return {...p,id:Number(p.id),price:Number(rooms.length?Math.min(...rooms.map(x=>Number(x.price))):p.price),capacity:Number(rooms.length?Math.max(...rooms.map(x=>Number(x.capacity))):p.capacity),room_types:rooms.length,total_capacity:rooms.reduce((sum,r)=>sum+Number(r.capacity)*Number(r.units),0),photos:photos.map(z=>({id:Number(z.id),src:z.image_url,label:z.caption||'Property photo'}))};}
const roomJSON =r=>({...r,id:Number(r.id),property_id:Number(r.property_id),price:Number(r.price),units:Number(r.units),capacity:Number(r.capacity)});
function bookingJSON(b,items,payment){const rooms=items.map(i=>({room_type_id:Number(i.room_type_id),name:i.room_name,quantity:Number(i.quantity),nightly_rate_cents:Number(i.nightly_rate_cents),line_subtotal_cents:Number(i.line_subtotal_cents)}));return {...b,id:Number(b.id),user_id:Number(b.user_id),property_id:Number(b.property_id),room_type_id:b.room_type_id?Number(b.room_type_id):null,check_in:isoDate(b.check_in),check_out:isoDate(b.check_out),total:Number(b.total),subtotal:Number(b.subtotal_cents)/100,service_fee:Number(b.service_fee_cents)/100,service_fee_percent:Number(b.service_fee_percent),room_count:rooms.reduce((n,i)=>n+i.quantity,0),rooms,payment_status:payment?.status||'unpaid',demo_payment_reference:payment?.reference||null,demo_payment_method:payment?.method||null,demo_amount:payment?Number(payment.amount_cents)/100:0,demo_paid_at:payment?.paid_at||null,demo_refunded_at:payment?.refunded_at||null};}
async function hydrateProperties(db,rows){return Promise.all(rows.map(async p=>{
 const [rooms,photos]=await Promise.all([query(db,'SELECT * FROM room_types WHERE property_id=$1 AND active=TRUE ORDER BY price,id',[p.id]),query(db,'SELECT * FROM property_photos WHERE property_id=$1 ORDER BY sort_order,id',[p.id])]);
 return propertyJSON(p,photos,rooms);
}));}
async function hydrateBookings(db,rows){return Promise.all(rows.map(async b=>{
 const [items,payment]=await Promise.all([
  query(db,'SELECT * FROM booking_items WHERE booking_id=$1 ORDER BY id',[b.id]),
  one(db,'SELECT reference,method,amount_cents,status,paid_at,refunded_at FROM demo_payments WHERE booking_id=$1',[b.id])
 ]);
 return bookingJSON(b,items,payment);
}));}
async function requiredUser(db,req,role=null){
 const token=(req.headers.get('authorization')||'').match(/^Bearer\s+([\w-]+)$/i)?.[1];
 must(token,401,'Sign in to continue.');
 const user=await one(db,`SELECT u.id,u.name,u.email,u.role,u.active FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>$2`,[sha256(token),nowSec()]);
 must(user?.active,401,'Session expired. Sign in again.');if(role)must(user.role===role,403,'Administrator access required.');return user;
}
async function isAvailable(db,room,start,end){
 const sum=await one(db,`SELECT COALESCE(SUM(i.quantity),0)::INTEGER AS booked FROM booking_items i JOIN bookings b ON b.id=i.booking_id
 WHERE i.room_type_id=$1 AND b.status IN ('pending','confirmed') AND b.check_in<$2::date AND b.check_out>$3::date`,[room.id,end,start]);
 return Math.max(0,Number(room.units)-Number(sum.booked));
}
async function quote(db,data,{lock=false}={}){
 const property_id=toInt(data.property_id,'Property'),guests=toInt(data.guests,'Guest count');
 must(guests>=1&&guests<=30,400,'Choose between 1 and 30 guests.');
 const {start,end,nights}=dates(data.check_in,data.check_out);
 const p=await one(db,'SELECT id,name FROM properties WHERE id=$1 AND active=TRUE',[property_id]);must(p,404,'This stay is unavailable.');
 const selection=data.rooms??(data.room_type_id?[{room_type_id:data.room_type_id,quantity:1}]:null);
 must(Array.isArray(selection),400,'Choose available rooms.');
 // In a writing transaction, lock all room rows for this property (consistent order)
 // BEFORE checking overlapping bookings; competing checkouts serialize on these locks.
 const rooms=await query(db,`SELECT * FROM room_types WHERE property_id=$1 AND active=TRUE ORDER BY id ${lock?'FOR UPDATE':''}`,[property_id]);
 const availableRooms=await Promise.all(rooms.map(async r=>({...r,available_units:await isAvailable(db,r,start,end)})));
 return calculation({propertyId:property_id,propertyName:p.name,guests,start,end,nights,selection,availableRooms});
}
function validContact(data,u){const contact_name=String(data.contact_name||u.name).trim(),contact_email=String(data.contact_email||u.email).trim().toLowerCase(),contact_phone=String(data.contact_phone||'').trim(),special_requests=String(data.special_requests||'').trim();
 must(contact_name.length>=2&&contact_name.length<=100&&validEmail(contact_email)&&(!contact_phone||/^[+\d()\-. ]{6,30}$/.test(contact_phone))&&special_requests.length<=1000,400,'Check your guest name, email, phone and special requests.');return {contact_name,contact_email,contact_phone,special_requests};}
// Local-only testing: requires BOTH Netlify Dev's actual `dev` context and
// an explicit opt-in in the uncommitted .env file. Never sends a code to browser.
function localDemoOTP(req){
 try {
  const host=new URL(req.url).hostname;
  return process.env.CONTEXT==='dev' && process.env.STAYHUB_LOCAL_DEMO_OTP==='true'
   && (host==='localhost'||host==='127.0.0.1'||host==='[::1]');
 } catch {return false;}
}
async function sendOTP(email,code,req){
 if(localDemoOTP(req)){
  console.info(`[StayHub LOCAL DEV OTP] ${email} | Code: ${code} | Expires in 10 minutes`);
  return;
 }
 const key=process.env.RESEND_API_KEY,from=process.env.STAYHUB_FROM_EMAIL;
 must(key&&from,503,'Email verification is not configured. Set RESEND_API_KEY and STAYHUB_FROM_EMAIL in the Backend environment.');
 let result;
 try {
  result=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(12000),body:JSON.stringify({from,to:[email],subject:'StayHub verification code',text:`Your StayHub security code is ${code}. It expires in 10 minutes. If you did not request it, ignore this email.`})});
 }catch{throw new HttpError(503,'Email provider is temporarily unreachable. Please try again.');}
 if(!result.ok)throw new HttpError(503,'Unable to deliver your security code. Try again shortly.');
}
async function challenge(db,user,req){
 must(process.env.STAYHUB_OTP_SECRET?.length>=32,503,'Secure email verification is not configured.');
 const code=String(randomInt(100000,1000000)),challenge_id=randomToken(24);
 await sendOTP(user.email,code,req); // local dev codes appear ONLY in the terminal
 await query(db,'DELETE FROM login_challenges WHERE user_id=$1',[user.id]);
 await query(db,'INSERT INTO login_challenges(id,user_id,code_hash,expires_at) VALUES($1,$2,$3,$4)',[challenge_id,user.id,otpHash(challenge_id,code),nowSec()+600]);
 return {challenge_id,message:'Verification code sent to email.'};
}
async function bootstrapAdmin(db,email){
 // Never ships a default admin password. The account can only be bootstrapped
 // when both private environment variables are explicitly configured.
 const configured=String(process.env.STAYHUB_ADMIN_EMAIL||'').trim().toLowerCase(),password=process.env.STAYHUB_ADMIN_PASSWORD;
 if(!configured||email!==configured||!password)return;
 must(validEmail(email)&&validPassword(password),503,'Admin bootstrap credentials must meet password requirements.');
 const already=await one(db,'SELECT id,role FROM users WHERE email=$1',[email]);
 if(already){must(already.role==='admin',409,'Admin email conflicts with an existing customer account. Contact the project administrator.');return;}
 await query(db,`INSERT INTO users(name,email,password_hash,role,email_verified) VALUES('StayHub Administrator',$1,$2,'admin',TRUE) ON CONFLICT(email) DO NOTHING`,[email,passwordHash(password)]);
 const created=await one(db,'SELECT role FROM users WHERE email=$1',[email]);
 must(created?.role==='admin',409,'Administrator account needs manual review.');
}
async function checkRate(db,key){const hashed=sha256(key);const row=await one(db,'SELECT * FROM auth_attempts WHERE subject=$1',[hashed]);if(row&&Number(row.window_start)>nowSec()-900&&Number(row.failures)>=8)throw new HttpError(429,'Too many sign-in attempts. Try again in 15 minutes.');return hashed;}
function clientIp(req){return (req.headers.get('x-nf-client-connection-ip')||req.headers.get('x-forwarded-for')?.split(',')[0]||'unknown').slice(0,90);}
// Atomically increment counters across all Function instances; never in-memory throttling.
async function consumeRate(db,subject,max=5){
 const key=sha256(subject),now=nowSec(),since=now-900;
 const row=await one(db,`INSERT INTO auth_attempts(subject,failures,window_start) VALUES($1,1,$2)
 ON CONFLICT(subject) DO UPDATE SET failures=CASE WHEN auth_attempts.window_start<$3 THEN 1 ELSE auth_attempts.failures+1 END,
 window_start=CASE WHEN auth_attempts.window_start<$3 THEN $2 ELSE auth_attempts.window_start END RETURNING failures`,[key,now,since]);
 must(Number(row.failures)<=max,429,'Too many requests. Please retry in 15 minutes.');
}
async function failLogin(db,key){await query(db,`INSERT INTO auth_attempts(subject,failures,window_start) VALUES($1,1,$2) ON CONFLICT(subject) DO UPDATE SET failures=CASE WHEN auth_attempts.window_start<$3 THEN 1 ELSE auth_attempts.failures+1 END,window_start=CASE WHEN auth_attempts.window_start<$3 THEN $2 ELSE auth_attempts.window_start END`,[key,nowSec(),nowSec()-900]);}
async function handler(req){
 const url=new URL(req.url),path=url.pathname.replace(/\/$/,'')||'/',method=req.method.toUpperCase();
 if(method==='GET'&&path==='/api/health')return {ok:true,service:'StayHub Netlify API',database:'PostgreSQL',payment_supported:false};
 if(method==='GET'&&path==='/api/pricing')return {service_fee_percent:6,currency:'MYR',payment_supported:false,simulated_payment_supported:true};
 if(method==='GET'&&path==='/api/ready'){const db=await database().connect();try{const row=await one(db,'SELECT (SELECT COUNT(*) FROM properties)::integer AS properties,(SELECT COUNT(*) FROM room_types)::integer AS rooms');return {ok:true,database:'connected',properties:row.properties,room_types:row.rooms};}finally{db.release();}}
 // Per-request connection; transactions use the SAME pinned client.
 const db=await database().connect();try{
 const get=(key)=>url.searchParams.get(key)?.trim()||'';
 const body=async()=>{const len=Number(req.headers.get('content-length')||0);must(len<=4400000,413,'Request too large.');const txt=await req.text();must(txt.length<=4500000,413,'Request too large.');try{return txt?JSON.parse(txt):{};}catch{throw new HttpError(400,'Invalid JSON payload.');}};
 if(method==='GET'&&path==='/api/destinations'){
  const rows=await query(db,`SELECT p.city,COUNT(*)::integer AS stay_count FROM properties p WHERE p.active=TRUE AND EXISTS(SELECT 1 FROM room_types r WHERE r.property_id=p.id AND r.active=TRUE AND r.units>0) GROUP BY p.city ORDER BY stay_count DESC,p.city`);
  return {destinations:rows};
 }
 if(method==='GET'&&path==='/api/properties'){
  const parts=['p.active=TRUE'],params=[];const add=(expr,value)=>{params.push(value);parts.push(expr.replaceAll('?',`$${params.length}`));};
  if(get('city')){const city=get('city').slice(0,70),aliased=({'kl':'Kuala Lumpur','k.l.':'Kuala Lumpur','jb':'Johor Bahru','penang':'George Town','kedah':'Langkawi'})[city.toLowerCase()]||city;
   params.push('%'+aliased+'%','%'+city+'%','%'+city+'%');const i=params.length;parts.push(`(p.city ILIKE $${i-2} OR p.name ILIKE $${i-1} OR p.address ILIKE $${i})`);}
  if(get('category'))add('p.category=?',get('category'));
  if(get('featured')==='1')parts.push('p.featured=TRUE');
  const low=get('min_price')?toInt(get('min_price'),'Minimum price'):0,high=get('max_price')?toInt(get('max_price'),'Maximum price'):9999999;
  must(high>=low,400,'Maximum price must not be below minimum price.');
  if(get('capacity')){const cap=toInt(get('capacity'),'Guests');must(cap>=1&&cap<=30,400,'Invalid guests.');}
  const amenity=url.searchParams.getAll('amenity');must(amenity.length<=8,400,'Too many facility filters.');
  for(const a of amenity){params.push(a.slice(0,45));parts.push(`EXISTS(SELECT 1 FROM jsonb_array_elements_text(p.amenities) AS item(value) WHERE LOWER(item.value)=LOWER($${params.length}))`);}
  const hasDates=get('check_in')||get('check_out');if(hasDates)dates(get('check_in'),get('check_out'));
  const properties=await query(db,`SELECT p.* FROM properties p WHERE ${parts.join(' AND ')} ORDER BY p.featured DESC,p.id DESC`,params);
  if(!properties.length)return {properties:[]};
  const ids=properties.map(p=>String(p.id));
  const roomRows=await query(db,`SELECT r.*,
   GREATEST(0,r.units-COALESCE((SELECT SUM(i.quantity) FROM booking_items i JOIN bookings b ON b.id=i.booking_id
     WHERE i.room_type_id=r.id AND b.status IN ('pending','confirmed') AND b.check_in<$2::date AND b.check_out>$3::date),0))::integer AS available_units
   FROM room_types r WHERE r.property_id=ANY($1::bigint[]) AND r.active=TRUE ORDER BY r.price,r.id`,
   [ids,hasDates?get('check_out'):'2099-01-01',hasDates?get('check_in'):'2099-01-01']);
  const allPhotos=await query(db,'SELECT * FROM property_photos WHERE property_id=ANY($1::bigint[]) ORDER BY sort_order,id',[ids]);
  const groups=new Map(),photoGroups=new Map();
  for(const r of roomRows){const key=String(r.property_id);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
  for(const p of allPhotos){const key=String(p.property_id);if(!photoGroups.has(key))photoGroups.set(key,[]);photoGroups.get(key).push(p);}
  const results=[];
  for(const p of properties){
    const rooms=groups.get(String(p.id))||[];const filtered=rooms.filter(r=>{
     const units=hasDates?Number(r.available_units):Number(r.units);return units>0&&Number(r.price)>=low&&Number(r.price)<=high;
    });
    if(!filtered.length||(get('capacity')&&filtered.reduce((n,r)=>n+(hasDates?Number(r.available_units):Number(r.units))*Number(r.capacity),0)<Number(get('capacity'))))continue;
    results.push({...propertyJSON(p,photoGroups.get(String(p.id))||[],rooms),price:Math.min(...filtered.map(r=>Number(r.price))),matching_room_types:filtered.length});
  }
  return {properties:results};
 }
 let m=path.match(/^\/api\/properties\/(\d+)$/);
 if(method==='GET'&&m){const p=await one(db,'SELECT * FROM properties WHERE id=$1 AND active=TRUE',[m[1]]);must(p,404,'Stay not found.');return {property:(await hydrateProperties(db,[p]))[0]};}
 m=path.match(/^\/api\/properties\/(\d+)\/rooms$/);
 if(method==='GET'&&m){const p=await one(db,'SELECT id FROM properties WHERE id=$1 AND active=TRUE',[m[1]]);must(p,404,'Property not found.');const guests=get('guests')?toInt(get('guests'),'Guests'):1;must(guests>=1&&guests<=30,400,'Invalid guest count.');const time=!!(get('check_in')||get('check_out'));if(time)dates(get('check_in'),get('check_out'));const rs=await query(db,'SELECT * FROM room_types WHERE property_id=$1 AND active=TRUE ORDER BY price,id',[m[1]]);return {rooms:await Promise.all(rs.map(async r=>({...roomJSON(r),available_units:time?await isAvailable(db,r,get('check_in'),get('check_out')):Number(r.units)})))};}
 if(method==='GET'&&path==='/api/auth/me')return {user:userJSON(await requiredUser(db,req))};
 if(method==='POST'&&path==='/api/auth/register'){
  const d=await body(),name=String(d.name||'').trim(),email=String(d.email||'').trim().toLowerCase(),password=String(d.password||'');
  must(name.length>=2&&name.length<=80&&validEmail(email)&&validPassword(password),400,'Enter a valid name/email and password with upper/lowercase letters, number and symbol (8+ chars).');
  // Fail closed: public registration cannot claim the reserved administrator identity.
  const reservedAdmin=String(process.env.STAYHUB_ADMIN_EMAIL||'').trim().toLowerCase();
  must(validEmail(reservedAdmin),503,'Administrator identity has not been configured.');
  must(email!==reservedAdmin,403,'This email is reserved and cannot be used for registration.');
  await consumeRate(db,'registration:'+clientIp(req),4);
  must(!(await one(db,'SELECT id FROM users WHERE email=$1',[email])),409,'This email is already registered.');
  const user=await one(db,`INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'customer') RETURNING id,email`,[name,email,passwordHash(password)]);
  try{return {__status:201,...await challenge(db,user,req)};}catch(error){await query(db,'DELETE FROM users WHERE id=$1',[user.id]);throw error;}
 }
 if(method==='POST'&&path==='/api/auth/login'){
  const d=await body(),email=String(d.email||'').trim().toLowerCase(),password=String(d.password||'');const ip=req.headers.get('x-nf-client-connection-ip')||req.headers.get('x-forwarded-for')?.split(',')[0]||'unknown';const key=await checkRate(db,ip+':'+email.slice(0,100));
  await bootstrapAdmin(db,email);const user=await one(db,'SELECT * FROM users WHERE email=$1',[email]);
  if(!user?.active||!passwordVerify(password,user.password_hash)){await failLogin(db,key);throw new HttpError(401,'Incorrect email or password.');}
  await consumeRate(db,'otp-email:'+email,5);
  await consumeRate(db,'otp-ip:'+clientIp(req),12);
  await query(db,'DELETE FROM auth_attempts WHERE subject=$1',[key]);return await challenge(db,user,req);
 }
 if(method==='POST'&&path==='/api/auth/verify'){
  const d=await body(),code=String(d.code||''),id=String(d.challenge_id||'');
  must(id.length>=20&&id.length<=128,400,'Invalid verification request.');
  await consumeRate(db,'verify-ip:'+clientIp(req),35);
  let inTransaction=false;
  try{
   await query(db,'BEGIN');inTransaction=true;
   const r=await one(db,'SELECT * FROM login_challenges WHERE id=$1 FOR UPDATE',[id]);
   if(!r||Number(r.expires_at)<=nowSec()){await query(db,'ROLLBACK');inTransaction=false;throw new HttpError(401,'Code expired. Please sign in again.');}
   if(Number(r.attempts)>=5){await query(db,'ROLLBACK');inTransaction=false;throw new HttpError(429,'Too many verification attempts. Sign in again.');}
   if(!/^\d{6}$/.test(code)||!secureEqual(otpHash(id,code),r.code_hash)){
    await query(db,'UPDATE login_challenges SET attempts=attempts+1 WHERE id=$1',[id]);
    await query(db,'COMMIT');inTransaction=false;
    throw new HttpError(400,'Incorrect verification code.');
   }
   await query(db,'DELETE FROM login_challenges WHERE id=$1',[id]);
   await query(db,'UPDATE users SET email_verified=TRUE WHERE id=$1',[r.user_id]);
   const token=randomToken(40);
   await query(db,'INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)',[sha256(token),r.user_id,nowSec()+28800]);
   const u=await one(db,'SELECT id,name,email,role FROM users WHERE id=$1',[r.user_id]);
   await query(db,'COMMIT');inTransaction=false;
   return {token,user:userJSON(u),expires_in:28800};
  }catch(e){if(inTransaction)await query(db,'ROLLBACK');throw e;}
 }
 if(method==='POST'&&path==='/api/admin/change-password'){
  const admin=await requiredUser(db,req,'admin');
  // Authenticated MFA session + current password are mandatory.
  await consumeRate(db,'admin-password-change:'+admin.id+':'+clientIp(req),8);
  const data=await body();
  must(typeof data.current_password==='string'&&typeof data.new_password==='string',400,'Enter current and new passwords.');
  return await changeAdminPassword(db,admin.id,data.current_password,data.new_password);
 }
 if(method==='POST'&&path==='/api/auth/logout'){await requiredUser(db,req);const token=req.headers.get('authorization').slice(7).trim();await query(db,'DELETE FROM sessions WHERE token_hash=$1',[sha256(token)]);return {ok:true};}
 if(method==='POST'&&path==='/api/quote'){return await quote(db,await body());}
 if(method==='GET'&&path==='/api/bookings'){
  const u=await requiredUser(db,req);const rows=await query(db,`SELECT b.*,p.name AS property_name,p.city,p.image_url,r.name AS room_name FROM bookings b JOIN properties p ON p.id=b.property_id LEFT JOIN room_types r ON r.id=b.room_type_id WHERE b.user_id=$1 ORDER BY b.id DESC`,[u.id]);return {bookings:await hydrateBookings(db,rows)};}
 m=path.match(/^\/api\/bookings\/(\d+)$/);
 if(method==='GET'&&m){const u=await requiredUser(db,req);const b=await one(db,`SELECT b.*,p.name AS property_name,p.city,p.image_url,r.name AS room_name FROM bookings b JOIN properties p ON p.id=b.property_id LEFT JOIN room_types r ON r.id=b.room_type_id WHERE b.id=$1 AND b.user_id=$2`,[m[1],u.id]);must(b,404,'Reservation not found.');const full=(await hydrateBookings(db,[b]))[0];full.nights=(new Date(full.check_out)-new Date(full.check_in))/86400000;return {booking:full};}
 if(method==='POST'&&path==='/api/bookings'){
  const u=await requiredUser(db,req);must(u.role==='customer',403,'Only customers can reserve rooms.');const data=await body(),contact=validContact(data,u);
  await query(db,'BEGIN');try{
    // Serialize guest deactivation with checkout to prevent a new reservation after access is disabled.
    const activeGuest=await one(db,"SELECT id FROM users WHERE id=$1 AND role='customer' AND active=TRUE FOR UPDATE",[u.id]);
    must(activeGuest,403,'Your customer account is inactive. Contact support.');
    const result=await quote(db,data,{lock:true});
    const roomType=result.rooms.length===1&&result.rooms[0].quantity===1?result.rooms[0].room_type_id:null;
    const b=await one(db,`INSERT INTO bookings(user_id,property_id,room_type_id,check_in,check_out,guests,total,subtotal_cents,service_fee_cents,total_cents,service_fee_percent,contact_name,contact_email,contact_phone,special_requests)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,6,$11,$12,$13,$14) RETURNING id`,[u.id,result.property_id,roomType,result.check_in,result.check_out,result.guests,result.total,result.subtotal_cents,result.service_fee_cents,result.total_cents,contact.contact_name,contact.contact_email,contact.contact_phone,contact.special_requests]);
    for(const line of result.rooms)await query(db,`INSERT INTO booking_items(booking_id,room_type_id,room_name,quantity,nightly_rate_cents,line_subtotal_cents) VALUES($1,$2,$3,$4,$5,$6)`,[b.id,line.room_type_id,line.name,line.quantity,line.nightly_rate_cents,line.line_subtotal_cents]);
    await query(db,'INSERT INTO notifications(user_id,booking_id,message) VALUES($1,$2,$3)',[u.id,b.id,'Booking submitted. Waiting for administrator confirmation.']);
    await query(db,'COMMIT');return {__status:201,booking_id:Number(b.id),total:result.total,subtotal:result.subtotal,service_fee:result.service_fee,rooms:result.rooms,status:'pending',message:'Booking request created. Optional demo payment is available; no real funds will be collected.'};
   }catch(e){await query(db,'ROLLBACK');throw e;}
 }
 m=path.match(/^\/api\/bookings\/(\d+)\/demo-pay$/);
 if(method==='POST'&&m){
  const user=await requiredUser(db,req);must(user.role==='customer',403,'Customer account required.');
  const d=await body();must(['demo_card','demo_wallet'].includes(d.method),400,'Choose a demo payment method.');
  await query(db,'BEGIN');try{
   const b=await one(db,'SELECT * FROM bookings WHERE id=$1 AND user_id=$2 FOR UPDATE',[m[1],user.id]);
   must(b,404,'Reservation not found.');
   const existing=await one(db,'SELECT * FROM demo_payments WHERE booking_id=$1',[b.id]);
   if(existing?.status==='paid'){
    await query(db,'COMMIT');return {ok:true,already_paid:true,payment_status:'paid',reference:existing.reference,amount:Number(existing.amount_cents)/100,simulated:true};
   }
   must(demoPaymentEligible(b.status,existing?.status||'unpaid'),409,'This reservation is not eligible for simulated payment.');
   const amount=Number(b.total_cents||Math.round(Number(b.total)*100));
   must(Number.isSafeInteger(amount)&&amount>0,409,'Reservation total is invalid.');
   const ref='DEMO-'+randomBytes(10).toString('hex').toUpperCase();
   await query(db,`INSERT INTO demo_payments(booking_id,reference,method,amount_cents,status) VALUES($1,$2,$3,$4,'paid')`,[b.id,ref,d.method,amount]);
   await query(db,'INSERT INTO notifications(user_id,booking_id,message) VALUES($1,$2,$3)',[user.id,b.id,'Demo payment recorded (simulation only; no real money collected).']);
   await query(db,'COMMIT');
   return {ok:true,payment_status:'paid',reference:ref,amount:amount/100,simulated:true,message:'Demo payment recorded. No funds were transferred.'};
  }catch(error){await query(db,'ROLLBACK');throw error;}
 }
 m=path.match(/^\/api\/bookings\/(\d+)\/cancel$/);
 if(method==='PATCH'&&m){const u=await requiredUser(db,req);
  await query(db,'BEGIN');try{
   const booking=await one(db,'SELECT * FROM bookings WHERE id=$1 AND user_id=$2 FOR UPDATE',[m[1],u.id]);
   must(booking&&['pending','confirmed'].includes(booking.status)&&isoDate(booking.check_in)>=isoDate(new Date()),409,'Booking not found or it is no longer eligible for cancellation.');
   await query(db,`UPDATE bookings SET status='cancelled',updated_at=NOW() WHERE id=$1`,[booking.id]);
   const payment=await one(db,'SELECT status FROM demo_payments WHERE booking_id=$1',[booking.id]);
   if(demoRefundRequired(payment?.status))await query(db,`UPDATE demo_payments SET status='refunded',refunded_at=NOW() WHERE booking_id=$1 AND status='paid'`,[booking.id]);
   await query(db,'INSERT INTO notifications(user_id,booking_id,message) VALUES($1,$2,$3)',[u.id,booking.id,payment?.status==='paid'?'Reservation cancelled. Demo payment marked refunded; no real funds transferred.':'Reservation cancelled.']);
   await query(db,'COMMIT');return {ok:true,status:'cancelled',payment_status:payment?.status==='paid'?'refunded':'unpaid'};
  }catch(error){await query(db,'ROLLBACK');throw error;}
 }
 if(method==='GET'&&path==='/api/admin/properties'){await requiredUser(db,req,'admin');return {properties:await hydrateProperties(db,await query(db,'SELECT * FROM properties ORDER BY id DESC'))};}
 m=path.match(/^\/api\/admin\/properties\/(\d+)\/rooms$/);
 if(method==='GET'&&m){await requiredUser(db,req,'admin');return {rooms:(await query(db,'SELECT * FROM room_types WHERE property_id=$1 ORDER BY id',[m[1]])).map(roomJSON)};}
 if(method==='GET'&&path==='/api/admin/users'){
  await requiredUser(db,req,'admin');
  // Customer-only view. A missing numeric ID in the sequence may be an admin or a deleted record.
  const rows=await query(db,`SELECT u.id,u.name,u.email,u.role,u.email_verified,u.active,u.created_at,
    COUNT(b.id)::integer AS booking_count,
    COUNT(b.id) FILTER (WHERE b.status IN ('pending','confirmed'))::integer AS open_booking_count
    FROM users u LEFT JOIN bookings b ON b.user_id=u.id
    WHERE u.role='customer' GROUP BY u.id ORDER BY u.id DESC`);
  return {users:rows.map(r=>({...r,id:Number(r.id)}))};
 }
 m=path.match(/^\/api\/admin\/customers\/(\d+)\/bookings$/);
 if(method==='GET'&&m){
  await requiredUser(db,req,'admin');
  const u=await one(db,"SELECT id,name,email,active,email_verified,created_at FROM users WHERE id=$1 AND role='customer'",[m[1]]);
  must(u,404,'Customer not found.');
  const rows=await query(db,`SELECT b.*,p.name AS property_name,p.city FROM bookings b JOIN properties p ON p.id=b.property_id WHERE b.user_id=$1 ORDER BY b.created_at DESC,b.id DESC LIMIT 100`,[m[1]]);
  return {customer:{...u,id:Number(u.id)},bookings:await hydrateBookings(db,rows)};
 }
 m=path.match(/^\/api\/admin\/customers\/(\d+)\/status$/);
 if(method==='PATCH'&&m){
  await requiredUser(db,req,'admin');
  const d=await body();must(typeof d.active==='boolean',400,'Choose an active or inactive status.');
  await query(db,'BEGIN');
  try {
   const u=await one(db,"SELECT id,active FROM users WHERE id=$1 AND role='customer' FOR UPDATE",[m[1]]);
   must(u,404,'Customer not found.');
   if(!d.active){
    const open=await one(db,"SELECT COUNT(*)::integer AS n FROM bookings WHERE user_id=$1 AND status IN ('pending','confirmed')",[m[1]]);
    must(Number(open.n)===0,409,'Customer has pending or confirmed reservations. Resolve those reservations before disabling access.');
   }
   await query(db,'UPDATE users SET active=$1 WHERE id=$2',[d.active,u.id]);
   if(!d.active)await query(db,'DELETE FROM sessions WHERE user_id=$1',[u.id]);
   await query(db,'COMMIT');return {ok:true,customer_id:Number(u.id),active:d.active};
  }catch(e){await query(db,'ROLLBACK');throw e;}
 }
 if(method==='GET'&&path==='/api/admin/bookings'){
  await requiredUser(db,req,'admin');const rows=await query(db,`SELECT b.*,p.name AS property_name,p.city,r.name AS room_name,u.name AS guest_name,u.email AS guest_email FROM bookings b JOIN properties p ON p.id=b.property_id LEFT JOIN room_types r ON r.id=b.room_type_id JOIN users u ON u.id=b.user_id ORDER BY b.id DESC`);return {bookings:await hydrateBookings(db,rows)};}
 if(method==='GET'&&path==='/api/admin/stats'){
  await requiredUser(db,req,'admin');const summaryRow=await one(db,`SELECT (SELECT COUNT(*) FROM properties WHERE active=TRUE)::integer AS properties,(SELECT COUNT(*) FROM bookings)::integer AS bookings,(SELECT COUNT(*) FROM users WHERE role='customer')::integer AS customers,(SELECT COUNT(*) FROM bookings WHERE status='pending')::integer AS pending,(SELECT COUNT(*) FROM bookings WHERE status='confirmed')::integer AS confirmed,(SELECT COALESCE(SUM(total),0) FROM bookings WHERE status IN ('confirmed','completed')) AS revenue,
   (SELECT COALESCE(SUM(total),0) FROM bookings WHERE status IN ('pending','confirmed','completed')) AS booking_value,
   (SELECT COALESCE(SUM(amount_cents),0) FROM demo_payments WHERE status='paid') AS demo_received_cents,
   (SELECT COUNT(*)::integer FROM demo_payments WHERE status='paid') AS demo_paid_bookings,
   (SELECT COALESCE(SUM(amount_cents),0) FROM demo_payments WHERE status='refunded') AS demo_refunded_cents`);
  const recent=await query(db,`SELECT b.id,b.check_in,b.status,b.total,p.name AS property_name,u.name AS guest_name FROM bookings b JOIN properties p ON p.id=b.property_id JOIN users u ON u.id=b.user_id ORDER BY b.id DESC LIMIT 5`);
  const statuses=await query(db,`SELECT status,COUNT(*)::integer AS count FROM bookings GROUP BY status`);
  const months=[];for(let i=5;i>=0;i--){const d=new Date();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-i);const month=d.toISOString().slice(0,7);const r=await one(db,`SELECT COUNT(*)::integer AS bookings,COALESCE(SUM(CASE WHEN status IN ('confirmed','completed') THEN total ELSE 0 END),0) AS revenue FROM bookings WHERE TO_CHAR(created_at,'YYYY-MM')=$1`,[month]);const demo=await one(db,`SELECT COALESCE(SUM(amount_cents),0) AS cents FROM demo_payments WHERE status='paid' AND TO_CHAR(paid_at,'YYYY-MM')=$1`,[month]);months.push({month,bookings:Number(r.bookings),revenue:Number(r.revenue),demo_revenue:Number(demo.cents)/100});}
  return {summary:{...summaryRow,revenue:Number(summaryRow.revenue),booking_value:Number(summaryRow.booking_value),demo_revenue:Number(summaryRow.demo_received_cents)/100,demo_refunded:Number(summaryRow.demo_refunded_cents)/100},months,statuses:['pending','confirmed','cancelled','completed'].map(status=>({status,count:statuses.find(r=>r.status===status)?.count||0})),recent:recent.map(r=>({...r,total:Number(r.total)}))};}
 if(method==='POST'&&path==='/api/admin/upload-image'){
  await requiredUser(db,req,'admin');const d=await body(),raw=String(d.image||''),match=raw.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  must(match,400,'Choose a JPG, PNG or WebP file.');const buffer=Buffer.from(match[2],'base64');must(buffer.length>=100&&buffer.length<=3000000,400,'Image must be less than 3 MB.');
  const mime=match[1],valid=(mime==='jpeg'&&buffer.subarray(0,3).equals(Buffer.from([255,216,255])))||(mime==='png'&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))||(mime==='webp'&&buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP');must(valid,400,'Invalid image data.');
  const ext=mime==='jpeg'?'jpg':mime,name=randomBytes(16).toString('hex')+'.'+ext;
  await getStore('stayhub-photos').set(name,buffer,{metadata:{contentType:'image/'+mime}});
  return {ok:true,url:'assets/uploads/'+name};
 }
 m=path.match(/^\/api\/admin\/properties\/(\d+)\/gallery$/);
 if(method==='POST'&&m){await requiredUser(db,req,'admin');const d=await body(),p=await one(db,'SELECT id FROM properties WHERE id=$1',[m[1]]);must(p,404,'Property not found.');const url=String(d.image_url||'').trim();must(validImageUrl(url),400,'Upload a photo or use an HTTPS URL.');
  const exists=await one(db,'SELECT id FROM property_photos WHERE image_url=$1 AND property_id<>$2',[url,m[1]]);must(!exists,409,'This photo already belongs to another property.');
  const count=await one(db,'SELECT COUNT(*)::integer AS n FROM property_photos WHERE property_id=$1',[m[1]]);must(count.n<12,400,'A gallery can contain up to 12 images.');
  await query(db,`INSERT INTO property_photos(property_id,image_url,caption,sort_order) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[m[1],url,String(d.caption||'').trim().slice(0,100),count.n]);return {ok:true};}
 m=path.match(/^\/api\/admin\/gallery\/(\d+)$/);
 if(method==='DELETE'&&m){await requiredUser(db,req,'admin');await query(db,'BEGIN');try{const p=await one(db,'SELECT * FROM property_photos WHERE id=$1 FOR UPDATE',[m[1]]);must(p,404,'Photo not found.');const total=await one(db,'SELECT COUNT(*)::integer AS n FROM property_photos WHERE property_id=$1',[p.property_id]);must(total.n>1,400,'Keep at least one gallery photo.');await query(db,'DELETE FROM property_photos WHERE id=$1',[m[1]]);const cover=await one(db,'SELECT image_url FROM properties WHERE id=$1',[p.property_id]);if(cover.image_url===p.image_url){const r=await one(db,'SELECT image_url FROM property_photos WHERE property_id=$1 ORDER BY sort_order,id LIMIT 1',[p.property_id]);await query(db,'UPDATE properties SET image_url=$1 WHERE id=$2',[r.image_url,p.property_id]);}await query(db,'COMMIT');return {ok:true};}catch(e){await query(db,'ROLLBACK');throw e;}}
 m=path.match(/^\/api\/admin\/gallery\/(\d+)\/cover$/);
 if(method==='POST'&&m){await requiredUser(db,req,'admin');const p=await one(db,'SELECT * FROM property_photos WHERE id=$1',[m[1]]);must(p,404,'Photo not found.');await query(db,'UPDATE properties SET image_url=$1,updated_at=NOW() WHERE id=$2',[p.image_url,p.property_id]);await query(db,'UPDATE property_photos SET sort_order=CASE WHEN id=$1 THEN -1 ELSE sort_order+1 END WHERE property_id=$2',[p.id,p.property_id]);return {ok:true};}
 if(method==='POST'&&path==='/api/admin/properties'){
  await requiredUser(db,req,'admin');const p=propertyInput(await body());await query(db,'BEGIN');try{
   const r=await one(db,`INSERT INTO properties(name,city,address,category,price,capacity,bedrooms,bathrooms,description,amenities,image_url,featured,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13) RETURNING id`,[p.name,p.city,p.address,p.category,p.price,p.capacity,p.bedrooms,p.bathrooms,p.description,JSON.stringify(p.amenities),p.image_url,p.featured,p.active]);
   await query(db,"INSERT INTO property_photos(property_id,image_url,caption,sort_order) VALUES($1,$2,'Cover photo',0)",[r.id,p.image_url]);
   await query(db,`INSERT INTO room_types(property_id,name,description,price,capacity,units,beds,size_sqm,image_url,amenities,active) VALUES($1,$2,$3,$4,$5,1,'1 double bed',$6,$7,$8::jsonb,$9)`,[r.id,p.category==='Homestay'?'Entire stay':'Standard Room','Comfortable private accommodation with essential amenities.',p.price,p.capacity,Math.max(20,p.bedrooms*24),p.image_url,JSON.stringify(p.amenities),p.active]);
   await query(db,'COMMIT');return {__status:201,id:Number(r.id),message:'Property created with a bookable room type.'};
  }catch(e){await query(db,'ROLLBACK');throw e;}}
 m=path.match(/^\/api\/admin\/properties\/(\d+)$/);
 if(['PUT','DELETE'].includes(method)&&m){await requiredUser(db,req,'admin');const prior=await one(db,'SELECT * FROM properties WHERE id=$1',[m[1]]);must(prior,404,'Property not found.');if(method==='DELETE'){await query(db,'UPDATE properties SET active=FALSE,updated_at=NOW() WHERE id=$1',[m[1]]);return {ok:true,message:'Property archived.'};}
  const p=propertyInput(await body());await query(db,`UPDATE properties SET name=$1,city=$2,address=$3,category=$4,price=$5,capacity=$6,bedrooms=$7,bathrooms=$8,description=$9,amenities=$10::jsonb,image_url=$11,featured=$12,active=$13,updated_at=NOW() WHERE id=$14`,[p.name,p.city,p.address,p.category,p.price,p.capacity,p.bedrooms,p.bathrooms,p.description,JSON.stringify(p.amenities),p.image_url,p.featured,p.active,m[1]]);
  await query(db,"INSERT INTO property_photos(property_id,image_url,caption,sort_order) VALUES($1,$2,'Property cover',0) ON CONFLICT DO NOTHING",[m[1],p.image_url]);const rooms=await query(db,'SELECT id,price FROM room_types WHERE property_id=$1 AND active=TRUE',[m[1]]);if(rooms.length===1&&Number(rooms[0].price)===Number(prior.price))await query(db,'UPDATE room_types SET price=$1 WHERE id=$2',[p.price,rooms[0].id]);return {ok:true,message:'Property updated.'};}
 m=path.match(/^\/api\/admin\/properties\/(\d+)\/rooms$/);
 if(method==='POST'&&m){await requiredUser(db,req,'admin');must(await one(db,'SELECT id FROM properties WHERE id=$1',[m[1]]),404,'Property not found.');const r=roomInput(await body());const created=await one(db,`INSERT INTO room_types(property_id,name,description,price,capacity,units,beds,size_sqm,image_url,amenities,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) RETURNING id`,[m[1],r.name,r.description,r.price,r.capacity,r.units,r.beds,r.size_sqm,r.image_url,JSON.stringify(r.amenities),r.active]);return {__status:201,id:Number(created.id),message:'Room type created.'};}
 m=path.match(/^\/api\/admin\/rooms\/(\d+)$/);
 if(['PUT','DELETE'].includes(method)&&m){
  await requiredUser(db,req,'admin');
  const r=method==='PUT'?roomInput(await body()):null;
  await query(db,'BEGIN');
  try{
   // Same row lock ordering as the checkout transaction; prevents a race
   // between lowering inventory and a concurrent new reservation.
   const old=await one(db,'SELECT id FROM room_types WHERE id=$1 FOR UPDATE',[m[1]]);
   must(old,404,'Room type not found.');
   if(method==='DELETE'){await query(db,'UPDATE room_types SET active=FALSE WHERE id=$1',[m[1]]);await query(db,'COMMIT');return {ok:true,message:'Room type hidden.'};}
   const peak=await one(db,`WITH occupied AS (
     SELECT day::date AS date,COALESCE(SUM(i.quantity),0)::integer AS units
     FROM generate_series(CURRENT_DATE,COALESCE((SELECT MAX(b.check_out)-1 FROM booking_items i JOIN bookings b ON b.id=i.booking_id
       WHERE i.room_type_id=$1 AND b.status IN ('pending','confirmed')),CURRENT_DATE),interval '1 day') AS day
     LEFT JOIN bookings b ON b.check_in<=day::date AND b.check_out>day::date AND b.status IN ('pending','confirmed')
     LEFT JOIN booking_items i ON i.booking_id=b.id AND i.room_type_id=$1
     GROUP BY day
    ) SELECT COALESCE(MAX(units),0)::integer AS units FROM occupied`,[m[1]]);
   must(r.units>=Number(peak.units),409,`At least ${peak.units} unit(s) are already reserved for overlapping dates.`);
   await query(db,`UPDATE room_types SET name=$1,description=$2,price=$3,capacity=$4,units=$5,beds=$6,size_sqm=$7,image_url=$8,amenities=$9::jsonb,active=$10 WHERE id=$11`,
     [r.name,r.description,r.price,r.capacity,r.units,r.beds,r.size_sqm,r.image_url,JSON.stringify(r.amenities),r.active,m[1]]);
   await query(db,'COMMIT');return {ok:true,message:'Room type updated.'};
  }catch(error){await query(db,'ROLLBACK');throw error;}
 }
 m=path.match(/^\/api\/admin\/bookings\/(\d+)\/status$/);
 if(method==='PATCH'&&m){await requiredUser(db,req,'admin');const d=await body(),status=String(d.status||'');must(['pending','confirmed','cancelled','completed'].includes(status),400,'Invalid booking status.');
  await query(db,'BEGIN');try{
   const b=await one(db,'SELECT * FROM bookings WHERE id=$1 FOR UPDATE',[m[1]]);must(b,404,'Booking not found.');
   const allowed={pending:['confirmed','cancelled'],confirmed:['cancelled','completed'],cancelled:[],completed:[]};must(allowed[b.status].includes(status),409,'This status change is not allowed.');
   await query(db,'UPDATE bookings SET status=$1,updated_at=NOW() WHERE id=$2',[status,b.id]);
   let refunded=false;
   if(status==='cancelled'){
    const payment=await one(db,'SELECT status FROM demo_payments WHERE booking_id=$1',[b.id]);
    if(demoRefundRequired(payment?.status)){await query(db,`UPDATE demo_payments SET status='refunded',refunded_at=NOW() WHERE booking_id=$1 AND status='paid'`,[b.id]);refunded=true;}
   }
   await query(db,'INSERT INTO notifications(user_id,booking_id,message) VALUES($1,$2,$3)',[b.user_id,b.id,'Your booking status is now '+status+'.'+(refunded?' Demo payment marked refunded; no real money was collected.':'')]);
   await query(db,'COMMIT');return {ok:true,status,payment_status:refunded?'refunded':undefined};
  }catch(error){await query(db,'ROLLBACK');throw error;}
 }
 throw new HttpError(404,'API endpoint not found.');
 }finally{db.release();}
}
export default async function api(req){
 const origin=req.headers.get('origin')||'';
 if(req.method==='OPTIONS'){const headers={...baseHeaders,'Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS'};if(allowedOrigins().includes(origin))headers['Access-Control-Allow-Origin']=origin;return new Response(null,{status:204,headers});}
 try{
  const path=new URL(req.url).pathname;
  const media=path.match(/^\/api\/media\/([a-f0-9]{32}\.(?:jpg|png|webp))$/);
  if(media&&req.method==='GET'){const blob=await getStore('stayhub-photos').get(media[1],{type:'arrayBuffer'});if(!blob)throw new HttpError(404,'Photo not found.');const type=media[1].endsWith('png')?'image/png':media[1].endsWith('webp')?'image/webp':'image/jpeg';return new Response(blob,{headers:{'Content-Type':type,'Cache-Control':'public,max-age=86400','X-Content-Type-Options':'nosniff'}});}
  const result=await handler(req);const status=result?.__status||200;if(result&&'__status'in result)delete result.__status;return response(result,status,origin);
 }catch(e){if(!(e instanceof HttpError))console.error('StayHub API failed:',e?.message);return response({error:e instanceof HttpError?e.message:'Server error. Please try again.'},e instanceof HttpError?e.status:500,origin);}
}
export const config={path:'/api/*'};
