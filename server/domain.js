import {randomUUID,scryptSync,timingSafeEqual,randomBytes} from 'node:crypto';
import {notifyBooking,notifyPaymentConfirmed} from './notifications.js';
export const id=()=>randomUUID();
export function fail(message,status=400){throw Object.assign(new Error(message),{status});}
export const find=(rows,key)=>rows.find(r=>r.id===key)||fail('Record not found',404);
export const statusOf=m=>m.status==='active'&&new Date(m.endsAt)<=new Date()?'expired':m.status;
export function hash(password){const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(password,salt,64).toString('hex');}
export function verify(password,encoded){if(!encoded)return false;const [salt,key]=encoded.split(':');return timingSafeEqual(Buffer.from(key,'hex'),scryptSync(password,salt,64));}
export function purchase(s,memberId,planId,method){
  find(s.members,memberId);const p=find(s.plans,planId);
  const pending=s.memberships.find(m=>m.memberId===memberId&&m.planId===planId&&m.status==='pending');
  if(pending){
    const existing=s.payments.find(p=>p.membershipId===pending.id);
    if(method==='online'&&existing?.method==='online')return existing;
    fail('This plan already has a pending payment. Complete it from Payments.');
  }
  const m={id:id(),memberId,planId,planName:p.name,kind:p.kind,gymAccess:p.gymAccess,classes:p.classes,days:p.days,credits:p.credits,status:'pending',startsAt:null,endsAt:null,createdAt:new Date().toISOString()};
  const payment={id:id(),memberId,membershipId:m.id,description:p.name,amount:p.price,currency:s.settings.currency,method,status:'pending',createdAt:new Date().toISOString(),paidAt:null};
  s.memberships.push(m);s.payments.push(payment);return payment;
}
export function activate(s,paymentId){
  const p=find(s.payments,paymentId);if(p.status==='paid')return p;
  const m=find(s.memberships,p.membershipId);const now=new Date();
  const previous=s.memberships.filter(x=>x.id!==m.id&&x.memberId===m.memberId&&x.planId===m.planId&&statusOf(x)==='active'&&x.kind!=='sessions');
  const start=new Date(Math.max(now.getTime(),...previous.map(x=>new Date(x.endsAt).getTime())));
  m.startsAt=start.toISOString();m.endsAt=new Date(start.getTime()+m.days*86400000).toISOString();m.status='active';p.status='paid';p.paidAt=now.toISOString();notifyPaymentConfirmed(s,p,m,now);return p;
}
export function book(s,memberId,classId){
  const c=find(s.schedule,classId);if(new Date(c.startsAt)<=new Date())fail('This session has already started.');
  const active=s.bookings.filter(b=>b.classId===classId&&b.status!=='cancelled');
  if(active.some(b=>b.memberId===memberId))fail('You already booked this session.');
  if(active.length>=c.capacity)fail('This session is full.');
  const m=s.memberships.find(m=>m.memberId===memberId&&statusOf(m)==='active'&&m.classes&&m.credits>0&&new Date(m.startsAt)<=new Date(c.startsAt)&&new Date(m.endsAt)>new Date(c.startsAt));
  if(!m)fail('An eligible membership with available class credits is required.');
  m.credits--;const b={id:id(),classId,memberId,membershipId:m.id,status:'booked',createdAt:new Date().toISOString()};s.bookings.push(b);notifyBooking(s,b);return b;
}
export function cancelBooking(s,bookingId){const b=find(s.bookings,bookingId);if(b.status!=='booked')fail('Only an upcoming booking can be cancelled.');const c=find(s.schedule,b.classId);if(new Date(c.startsAt)<=new Date())fail('This session has already started.');const early=new Date(c.startsAt)-Date.now()>=s.settings.cancellationHours*3600000;if(early)find(s.memberships,b.membershipId).credits++;b.status='cancelled';b.creditReturned=early;notifyBooking(s,b,true);return b;}
export function checkIn(s,memberId){const m=s.memberships.find(m=>m.memberId===memberId&&statusOf(m)==='active'&&m.gymAccess&&new Date(m.startsAt)<=new Date());if(!m)fail('This member has no active gym access.');const today=new Intl.DateTimeFormat('en-CA',{timeZone:s.settings.timezone}).format(new Date());if(s.attendance.some(a=>a.memberId===memberId&&new Intl.DateTimeFormat('en-CA',{timeZone:s.settings.timezone}).format(new Date(a.createdAt))===today))fail('This member is already checked in today.');const a={id:id(),memberId,createdAt:new Date().toISOString()};s.attendance.unshift(a);return a;}
