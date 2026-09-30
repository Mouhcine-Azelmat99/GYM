import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
export const auditContext=new AsyncLocalStorage();
const fields={members:['name','email','phone','photo','notificationPreferences'],users:['name','email','role','passwordHash'],memberships:['status','startsAt','endsAt','credits'],payments:['status','amount','method','confirmedBy'],bookings:['status'],attendance:['memberId'],plans:['name','price','days','credits'],schedule:['title','startsAt','trainerId','capacity'],invitations:['status','expiresAt']};
export function recordChanges(before,after){
  const context=auditContext.getStore();const actor=context?.actor?.()||{id:'system',name:'System',role:'system'};
  const entries=[];
  const add=(entity,id,action,changed)=>entries.push({id:randomUUID(),createdAt:new Date().toISOString(),actorId:actor.id,actorName:actor.name,actorRole:actor.role,entity,recordId:id,action,fields:changed.map(f=>f==='passwordHash'?'password':f)});
  for(const [entity,keys] of Object.entries(fields)){
    const previous=new Map((before[entity]||[]).map(row=>[row.id,row]));
    for(const row of after[entity]||[]){const old=previous.get(row.id);if(!old)add(entity,row.id,'created',[]);else {const changed=keys.filter(key=>JSON.stringify(old[key])!==JSON.stringify(row[key]));if(changed.length)add(entity,row.id,'updated',changed);}previous.delete(row.id);}
    for(const id of previous.keys())add(entity,id,'deleted',[]);
  }
  if(JSON.stringify(before.settings)!==JSON.stringify(after.settings))add('settings','gym','updated',Object.keys(after.settings).filter(k=>JSON.stringify(before.settings?.[k])!==JSON.stringify(after.settings[k])));
  if(entries.length)after.auditLogs=[...(after.auditLogs||[]),...entries].slice(-5000);
}
