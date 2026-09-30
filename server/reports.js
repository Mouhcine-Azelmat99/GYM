import {fail} from './domain.js';
export function localDate(value,timeZone){return new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
// First instant on a calendar date, including timezone/DST boundaries.
function boundary(day,zone){let low=Date.parse(day)-36*3600000,high=Date.parse(day)+36*3600000;while(high-low>1){const mid=Math.floor((high+low)/2);if(localDate(mid,zone)<day)low=mid;else high=mid;}return high;}
export function report(state,from,to,now=new Date()){
  const zone=state.settings.timezone;
  if(!validDate(from)||!validDate(to)||from>to||to>localDate(now,zone)||Date.parse(to)-Date.parse(from)>366*86400000)fail('Choose a valid date range of up to 367 days, ending today or earlier.');
  const start=boundary(from,zone),next=new Date(Date.parse(to)+86400000).toISOString().slice(0,10),end=Math.min(boundary(next,zone),+now);
  const inRange=value=>value&&+new Date(value)>=start&&+new Date(value)<end;
  const paid=state.payments.filter(p=>p.status==='paid'&&inRange(p.paidAt));
  const totals=new Map(),months=new Map();
  for(const p of paid){const row=totals.get(p.currency)||{currency:p.currency,total:0,cash:0,online:0,count:0};row.total+=p.amount;row[p.method==='cash'?'cash':'online']+=p.amount;row.count++;totals.set(p.currency,row);const month=localDate(p.paidAt,zone).slice(0,7),key=month+':'+p.currency;const m=months.get(key)||{month,currency:p.currency,total:0};m.total+=p.amount;months.set(key,m);}
  const paidMembershipIds=new Set(state.payments.filter(p=>p.status==='paid').map(p=>p.membershipId));
  const eligible=state.memberships.filter(m=>m.startsAt&&m.endsAt&&m.status!=='pending'&&paidMembershipIds.has(m.id));
  const activeAt=instant=>new Set(eligible.filter(m=>+new Date(m.startsAt)<=instant&&+new Date(m.endsAt)>instant).map(m=>m.memberId));
  const opening=activeAt(start),closing=activeAt(Math.max(start,end-1));
  const retained=[...opening].filter(id=>closing.has(id)).length;
  const due=new Set(eligible.filter(m=>inRange(m.endsAt)).map(m=>m.memberId));
  const renewed=[...due].filter(id=>eligible.some(m=>m.memberId===id&&inRange(m.startsAt)&&eligible.some(old=>old.id!==m.id&&old.memberId===id&&inRange(old.endsAt)&&+new Date(m.startsAt)>=+new Date(old.endsAt)))).length;
  return {from,to,timeZone:zone,currency:state.settings.currency,revenue:[...totals.values()],monthly:[...months.values()].sort((a,b)=>a.month.localeCompare(b.month)||a.currency.localeCompare(b.currency)),newMembers:state.members.filter(m=>inRange(m.joinedAt)).length,visits:state.attendance.filter(a=>inRange(a.createdAt)).length,openingMembers:opening.size,closingMembers:closing.size,retained,lost:opening.size-retained,retentionRate:opening.size?Math.round(retained/opening.size*1000)/10:null,renewalEligible:due.size,renewed,renewalRate:due.size?Math.round(renewed/due.size*1000)/10:null};
}
