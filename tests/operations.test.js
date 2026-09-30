import {test} from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {createApp} from '../server/app.js';
import {createStore} from '../server/store.js';
import {issueInvitation,acceptInvitation} from '../server/invitations.js';
import {shouldEmail} from '../server/notifications.js';
import {emailContent} from '../server/email.js';
import {report} from '../server/reports.js';
import {createNotificationWorker} from '../server/notification-worker.js';

test('staff invitation grants access to existing records exactly once and hides secrets',async()=>{
 const store=await createStore({memory:true}),app=createApp({store}),owner=request.agent(app),member=request.agent(app);
 await owner.post('/api/auth/demo').send({role:'owner'}).expect(200);
 const {body:invite}=await owner.post('/api/members/member-2/invitation').send({}).expect(200);
 const token=invite.demoUrl.split('#invite=')[1];assert.equal(token.length,64);
 const state=(await owner.get('/api/state')).body;assert.equal(state.invitations,undefined);assert.equal(state.auditLogs,undefined);assert.ok(!JSON.stringify(state).includes(token));assert.ok(!JSON.stringify(state).includes('tokenHash'));
 const s=await store.read(),n=s.notifications.find(n=>n.type==='member-invitation');assert.ok(shouldEmail(s,n));
 const content=emailContent({notification:n,member:s.members.find(m=>m.id==='member-2'),settings:s.settings,appUrl:'https://gym.example',invitationSecret:process.env.SESSION_SECRET||'local-demo-only-not-for-production'});assert.ok(content.text.includes('#invite='+token));
 await member.post('/api/auth/invitation').send({token,password:'Invite-password-123'}).expect(200);
 const profile=(await member.get('/api/state')).body;assert.equal(profile.user.memberId,'member-2');assert.ok(profile.memberships.length>0);
 await member.post('/api/auth/invitation').send({token,password:'Another-password-123'}).expect(400);
 await owner.post('/api/members/member-2/invitation').send({}).expect(400);
 assert.equal(shouldEmail(await store.read(),n),false);
 await member.get('/api/audit').expect(403);await member.get('/api/reports?from=2026-01-01&to=2026-01-31').expect(403);
});
test('resend, revoke and expiry invalidate tokens and stale email jobs',async()=>{
 const store=await createStore({memory:true}),now=new Date();
 const first=await store.mutate(s=>issueInvitation(s,'member-2','test-secret',now));
 await assert.rejects(store.mutate(s=>issueInvitation(s,'member-2','test-secret',now)),/Wait one minute/);
 const second=await store.mutate(s=>issueInvitation(s,'member-2','test-secret',new Date(+now+61000)));
 await assert.rejects(store.mutate(s=>acceptInvitation(s,first.token,'Invite-password-123')),/invalid or expired/);
 const s=await store.read();assert.equal(shouldEmail(s,s.notifications.find(n=>n.referenceId===first.id)),false);
 await assert.rejects(store.mutate(s=>acceptInvitation(s,second.token,'Invite-password-123',new Date(+now+49*3600000))),/invalid or expired/);
 await store.mutate(s=>{s.invitations[0].status='revoked';});
 await assert.rejects(store.mutate(s=>acceptInvitation(s,second.token,'Invite-password-123')),/invalid or expired/);
});
test('invitation acceptance races cannot create duplicate users; worker delivers queued invitation',async()=>{
 const store=await createStore({memory:true});const invite=await store.mutate(s=>issueInvitation(s,'member-2','test-secret'));
 const delivered=[];await createNotificationWorker({store,sender:{config:{enabled:true},send:async job=>{delivered.push(job.notification.type);return 'mock-id';}}}).tick();assert.ok(delivered.includes('member-invitation'));
 const results=await Promise.allSettled([store.mutate(s=>acceptInvitation(s,invite.token,'Invite-password-123')),store.mutate(s=>acceptInvitation(s,invite.token,'Invite-password-123'))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
test('audit attributes actors, excludes secrets, ignores failed/no-op writes and paginates',async()=>{
 const store=await createStore({memory:true}),app=createApp({store}),owner=request.agent(app);
 await owner.post('/api/auth/demo').send({role:'owner'});
 await owner.post('/api/members').send({name:'Audit Member',email:'audit@example.com'}).expect(201);
 const before=(await store.read()).auditLogs.length;
 await owner.post('/api/members').send({name:'Audit Member',email:'audit@example.com'}).expect(400);
 await store.mutate(()=>{});assert.equal((await store.read()).auditLogs.length,before);
 const {body}=await owner.get('/api/audit?search=members&page=1').expect(200);assert.equal(body.rows[0].actorId,'owner');assert.equal(body.rows[0].action,'created');assert.ok(!JSON.stringify(body).includes('audit@example.com'));
 await owner.get('/api/audit?page=-1').expect(400);
 const reception=request.agent(app);await reception.post('/api/auth/demo').send({role:'receptionist'});await reception.get('/api/audit').expect(403);await reception.get('/api/reports').expect(403);
});
test('repeated cash confirmation preserves the original cashier and adds no audit entries',async()=>{
 const store=await createStore({memory:true}),app=createApp({store}),owner=request.agent(app),reception=request.agent(app);
 await owner.post('/api/auth/demo').send({role:'owner'});await reception.post('/api/auth/demo').send({role:'receptionist'});
 await owner.post('/api/payments/payment-3/confirm').send({}).expect(200);
 const before=await store.read();await reception.post('/api/payments/payment-3/confirm').send({}).expect(200);
 const after=await store.read();assert.equal(after.payments.find(p=>p.id==='payment-3').confirmedBy,'owner');assert.equal(after.auditLogs.length,before.auditLogs.length);
});
test('reports count paid revenue by timezone payment date and retain the opening cohort',()=>{
 const state={settings:{timezone:'America/New_York',currency:'USD'},members:[{id:'a',joinedAt:'2026-02-01T12:00:00Z'},{id:'b',joinedAt:'2026-03-15T12:00:00Z'}],memberships:[{id:'old',memberId:'a',startsAt:'2026-02-01T00:00:00Z',endsAt:'2026-03-10T12:00:00Z',status:'active'},{id:'renew',memberId:'a',startsAt:'2026-03-10T12:00:00Z',endsAt:'2026-04-15T00:00:00Z',status:'active'},{id:'new',memberId:'b',startsAt:'2026-03-15T12:00:00Z',endsAt:'2026-04-15T00:00:00Z',status:'active'}],payments:[{membershipId:'old',status:'paid',amount:5000,currency:'USD',method:'cash',paidAt:'2026-02-01T12:00:00Z'},{membershipId:'renew',status:'paid',amount:6000,currency:'USD',method:'online',paidAt:'2026-03-10T12:00:00Z'},{membershipId:'new',status:'paid',amount:7000,currency:'EUR',method:'cash',paidAt:'2026-03-15T12:00:00Z'},{status:'pending',amount:999999,currency:'USD',paidAt:'2026-03-15T12:00:00Z'},{status:'paid',amount:1000,currency:'USD',method:'cash',paidAt:'2026-03-01T03:00:00Z'}],attendance:[{createdAt:'2026-03-30T12:00:00Z'}]};
 const r=report(state,'2026-03-01','2026-03-31',new Date('2026-04-01T12:00:00Z'));
 assert.equal(r.revenue.find(r=>r.currency==='USD').total,6000);assert.equal(r.revenue.find(r=>r.currency==='EUR').total,7000);assert.equal(r.openingMembers,1);assert.equal(r.closingMembers,2);assert.equal(r.retentionRate,100);assert.equal(r.renewed,1);assert.equal(r.newMembers,1);assert.equal(r.visits,1);
 assert.throws(()=>report(state,'2026-02-30','2026-03-31'),/valid date range/);
 assert.throws(()=>report(state,'2026-03-31','2026-03-01'),/valid date range/);
 const empty=report({...state,members:[],memberships:[],payments:[],attendance:[]},'2026-03-01','2026-03-31',new Date('2026-04-01'));assert.equal(empty.retentionRate,null);assert.equal(empty.revenue.length,0);
});
