export async function api(path,body,method=body?'POST':'GET') {
  const response=await fetch('/api'+path,{method,credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
  let result;
  try{result=await response.json();}catch{throw Object.assign(new Error('The API is unavailable. Check that the server is running and connected to MongoDB.'),{status:response.status});}
  if(!response.ok)throw Object.assign(new Error(result.message||'Request failed.'),{status:response.status});return result;
}
export const money=(amount,currency='USD')=>new Intl.NumberFormat('en',{style:'currency',currency,maximumFractionDigits:amount%100?2:0}).format(amount/100);
export const date=(value,options={})=>value?new Intl.DateTimeFormat('en',{month:'short',day:'numeric',...options}).format(new Date(value)):'Not started';
export const initials=name=>name.split(' ').map(n=>n[0]).slice(0,2).join('');
export const latestMembership=(s,memberId)=>s.memberships.filter(m=>m.memberId===memberId).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0];
