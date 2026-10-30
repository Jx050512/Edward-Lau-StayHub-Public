import { randomBytes, createHash, createHmac, timingSafeEqual, pbkdf2Sync } from 'node:crypto';

export class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes=32) => randomBytes(bytes).toString('base64url');
export const validEmail = value => typeof value === 'string' && value.length<=254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export const validPassword = value => typeof value === 'string' && value.length>=8 && value.length<=128 && /[A-Z]/.test(value)&&/[a-z]/.test(value)&&/[0-9]/.test(value)&&/[^A-Za-z0-9]/.test(value);
export const toInt=(value,what='Number')=>{if(value===null||value===undefined||value===''||!/^\d+$/.test(String(value)))throw new HttpError(400,`${what} must be a whole number.`);return Number(value)};
export const dates=(start,end)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(start||'')||!/^\d{4}-\d{2}-\d{2}$/.test(end||''))throw new HttpError(400,'Choose valid check-in and check-out dates.');const a=new Date(`${start}T00:00:00Z`),b=new Date(`${end}T00:00:00Z`);const today=new Date().toISOString().slice(0,10);const nights=(b-a)/86400000;if(Number.isNaN(nights)||Number.isNaN(a.getTime())||Number.isNaN(b.getTime())||a.toISOString().slice(0,10)!==start||b.toISOString().slice(0,10)!==end||start<today||!Number.isInteger(nights)||nights<1||nights>30)throw new HttpError(400,'Choose future check-in/check-out dates between 1 and 30 nights.');return {start,end,nights};};
export const passwordHash=(password,salt=randomBytes(16).toString('hex'))=>`${salt}:${pbkdf2Sync(password,Buffer.from(salt,'hex'),300000,32,'sha256').toString('hex')}`;
export function passwordVerify(password,encoded){try{const [salt,hash]=encoded.split(':');const expected=Buffer.from(hash,'hex');const actual=pbkdf2Sync(password,Buffer.from(salt,'hex'),300000,32,'sha256');return expected.length===actual.length&&timingSafeEqual(expected,actual);}catch{return false;}}
export const otpHash=(challenge,code)=>createHmac('sha256',process.env.STAYHUB_OTP_SECRET||'').update(`${challenge}:${code}`).digest('hex');
export const secureEqual=(a,b)=>{const aa=Buffer.from(String(a)),bb=Buffer.from(String(b));return aa.length===bb.length&&timingSafeEqual(aa,bb)};
export const validImageUrl=value=>typeof value==='string'&&( /^https:\/\/[^\s"'<>]{5,995}$/.test(value)||/^assets\/uploads\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(value));
export const feeFor = subtotalCents => Math.floor((subtotalCents*6+50)/100);
export function calculation({propertyId,propertyName,guests,start,end,nights,selection,availableRooms}){
  const aggregated=new Map(); if(!Array.isArray(selection)||!selection.length||selection.length>12)throw new HttpError(400,'Choose at least one available room type.');
  for(const x of selection){const id=toInt(x.room_type_id,'Room ID'),quantity=toInt(x.quantity??1,'Room quantity');if(quantity<1||quantity>20)throw new HttpError(400,'Select between 1 and 20 units per room type.');aggregated.set(id,(aggregated.get(id)||0)+quantity);}
  if([...aggregated.values()].reduce((a,b)=>a+b,0)>20)throw new HttpError(400,'A reservation supports up to 20 rooms.');
  let subtotal=0,capacity=0;const lines=[];
  for(const [id,quantity] of [...aggregated].sort((a,b)=>a[0]-b[0])){
    const room=availableRooms.find(r=>Number(r.id)===id&&r.active!==false);
    if(!room)throw new HttpError(404,'A selected room type is unavailable.');
    if(Number(room.available_units)<quantity)throw new HttpError(409,`${room.name}: only ${room.available_units} room(s) left for the selected dates.`);
    const price=Number(room.price),cents=price*100;const line=cents*quantity*nights;
    capacity+=Number(room.capacity)*quantity;subtotal+=line;
    lines.push({room_type_id:id,name:room.name,quantity,capacity_per_room:Number(room.capacity),available_units:Number(room.available_units),price_per_night:price,nightly_rate_cents:cents,line_subtotal_cents:line,line_subtotal:line/100});
  }
  if(guests>capacity)throw new HttpError(400,`Your selected rooms accommodate up to ${capacity} guests. Add rooms or reduce guest count.`);
  const fee=feeFor(subtotal);return {property_id:propertyId,property_name:propertyName,check_in:start,check_out:end,nights,guests,rooms:lines,room_count:[...aggregated.values()].reduce((a,b)=>a+b,0),total_capacity:capacity,subtotal_cents:subtotal,service_fee_cents:fee,service_fee_percent:6,total_cents:subtotal+fee,subtotal:subtotal/100,service_fee:fee/100,total:(subtotal+fee)/100,payment_collected:0,currency:'MYR'};
}
export function propertyInput(d){const name=String(d.name||'').trim(),city=String(d.city||'').trim(),address=String(d.address||'').trim(),category=String(d.category||''),description=String(d.description||'').trim(),image_url=String(d.image_url||'').trim();const price=toInt(d.price,'Price'),capacity=toInt(d.capacity,'Capacity'),bedrooms=toInt(d.bedrooms??1,'Bedrooms'),bathrooms=toInt(d.bathrooms??1,'Bathrooms');const amenities=d.amenities;
 if(name.length<3||name.length>100||city.length<2||city.length>80||address.length<5||address.length>180||description.length<20||description.length>1200||!['Hotel','Homestay','Resort','Apartment'].includes(category)||price<30||price>10000||capacity<1||capacity>30||bedrooms>20||bathrooms<1||bathrooms>20||!validImageUrl(image_url)||!Array.isArray(amenities)||amenities.length>12||amenities.some(x=>typeof x!=='string'||x.length>45))throw new HttpError(400,'Invalid property details, price, capacity or image URL.');
 return {name,city,address,category,description,image_url,price,capacity,bedrooms,bathrooms,amenities,featured:!!d.featured,active:d.active!==false};}
export function roomInput(d){const name=String(d.name||'').trim(),description=String(d.description||'').trim(),beds=String(d.beds||'').trim(),image_url=String(d.image_url||'').trim(),price=toInt(d.price,'Room price'),capacity=toInt(d.capacity,'Capacity'),units=toInt(d.units,'Units'),size_sqm=toInt(d.size_sqm,'Room size');if(name.length<3||name.length>95||description.length<10||description.length>700||beds.length<2||beds.length>80||price<30||price>20000||capacity<1||capacity>20||units<1||units>100||size_sqm<8||size_sqm>500||!validImageUrl(image_url)||!Array.isArray(d.amenities)||d.amenities.length>20)throw new HttpError(400,'Invalid room details, rate, inventory or image URL.');return {name,description,beds,image_url,price,capacity,units,size_sqm,amenities:d.amenities.map(x=>String(x).slice(0,70)),active:d.active!==false};}

// A demo receipt represents simulated funds only; it is never a card charge.
export const demoPaymentEligible = (bookingStatus,paymentStatus) =>
  ['pending','confirmed'].includes(bookingStatus) && paymentStatus==='unpaid';
export const demoRefundRequired = (paymentStatus) => paymentStatus==='paid';
export function demoReceivedCents(entries){
 return entries.reduce((sum,p)=>sum+(p.status==='paid'?Number(p.amount_cents):0),0);
}
