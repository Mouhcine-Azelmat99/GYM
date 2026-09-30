import {createHmac,timingSafeEqual} from 'node:crypto';
import {checkIn,fail,find} from './domain.js';
const sign=(payload,secret)=>createHmac('sha256',secret).update('forma-checkin-v1:'+payload).digest('base64url');
const day=(value,zone)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
export function memberCheckIn(state,memberId,secret,now=new Date()){
  find(state.members,memberId);
  const today=day(now,state.settings.timezone),month=today.slice(0,7);
  const visits=state.attendance.filter(a=>a.memberId===memberId&&new Date(a.createdAt)<=now);
  const checkedInToday=visits.some(a=>day(a.createdAt,state.settings.timezone)===today);
  const eligible=state.memberships.some(m=>m.memberId===memberId&&m.status==='active'&&m.gymAccess&&new Date(m.startsAt)<=now&&new Date(m.endsAt)>now);
  const expiresAt=new Date(+now+90000).toISOString();
  const payload=Buffer.from(JSON.stringify({memberId,issuedAt:+now,expiresAt:+new Date(expiresAt)})).toString('base64url');
  return {token:eligible&&!checkedInToday?`FORMA1.${payload}.${sign(payload,secret)}`:null,expiresAt,serverTime:now.toISOString(),timeZone:state.settings.timezone,month,monthlyAttendance:visits.filter(a=>day(a.createdAt,state.settings.timezone).slice(0,7)===month).length,checkedInToday,eligible};
}
export function readCheckInToken(token,secret,now=new Date()){
  if(typeof token!=='string'||token.length>1024)fail('Invalid gym QR code.');
  const parts=token.split('.');
  if(parts.length!==3||parts[0]!=='FORMA1'||!parts.slice(1).every(p=>/^[A-Za-z0-9_-]+$/.test(p)))fail('Invalid gym QR code.');
  const signature=Buffer.from(parts[2],'base64url'),expected=Buffer.from(sign(parts[1],secret),'base64url');
  if(signature.length!==expected.length||!timingSafeEqual(signature,expected))fail('Invalid gym QR code.');
  let data;try{data=JSON.parse(Buffer.from(parts[1],'base64url').toString());}catch{fail('Invalid gym QR code.');}
  if(!data||typeof data.memberId!=='string'||!Number.isSafeInteger(data.issuedAt)||!Number.isSafeInteger(data.expiresAt)||data.expiresAt-data.issuedAt!==90000||data.issuedAt>+now+5000)fail('Invalid gym QR code.');
  if(data.expiresAt<=+now)fail('This QR code expired. Ask the member to refresh it.');
  return data.memberId;
}
export function scanCheckIn(state,token,secret,actorId){
  const memberId=readCheckInToken(token,secret),member=find(state.members,memberId);
  const visit=checkIn(state,memberId);visit.source='qr';visit.checkedBy=actorId;
  return {visit,member:{id:member.id,name:member.name},monthlyAttendance:memberCheckIn(state,memberId,secret).monthlyAttendance};
}
