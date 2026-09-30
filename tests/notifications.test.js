import {test} from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {createStore} from '../server/store.js';
import {createApp} from '../server/app.js';
import {createExpiryReminders,notifyBooking,shouldEmail,notificationsFor} from '../server/notifications.js';
import {createNotificationWorker} from '../server/notification-worker.js';
import {emailConfiguration,emailContent} from '../server/email.js';
import {purchase,activate} from '../server/domain.js';

test('registration and staff member creation queue welcome notifications atomically',async()=>{
 const store=await createStore({memory:true}),client=request.agent(createApp({store}));
 await client.post('/api/auth/register').send({name:'New Member',email:'new-member@example.com',password:'Test-password-123'}).expect(201);
 const {body}=await client.get('/api/state').expect(200);
 assert.equal(body.notifications.length,1);assert.equal(body.notifications[0].type,'account-created');
 await client.post('/api/auth/register').send({name:'New Member',email:'new-member@example.com',password:'Test-password-123'}).expect(400);
 assert.equal((await store.read()).notifications.length,1);
 await client.post('/api/auth/demo').send({role:'owner'}).expect(200);
 await client.post('/api/members').send({name:'Reception Member',email:'reception-member@example.com'}).expect(201);
 const s=await store.read();assert.equal(s.notifications.length,2);assert.match(s.notifications[1].body,/member record/);
 assert.ok(shouldEmail(s,s.notifications[0]));
});

test('cash and online activation queue one receipt and plan confirmation, including future renewals',async()=>{
 for(const method of ['cash','online']){
  const store=await createStore({memory:true});
  const payment=await store.mutate(s=>purchase(s,'member-1',s.memberships[0].planId,method));
  assert.equal((await store.read()).notifications.length,0);
  await store.mutate(s=>activate(s,payment.id));await store.mutate(s=>activate(s,payment.id));
  const s=await store.read();assert.equal(s.notifications.length,2);
  assert.deepEqual(s.notifications.map(n=>n.type),['payment-completed','membership-confirmed']);
  s.members[0].notificationPreferences={bookingEmails:false,expiryEmails:false};
  for(const n of s.notifications){assert.ok(shouldEmail(s,n));const content=emailContent({notification:n,member:s.members[0],settings:s.settings,appUrl:'https://gym.example'});assert.ok(content.text.includes('#'+n.target));}
  assert.match(s.notifications[1].body,/from .* to /);
 }
});

const now=new Date('2026-09-20T12:00:00Z');
function fixture(){return {settings:{name:'Test Gym',timezone:'UTC'},members:[{id:'m',name:'A <B>',email:'member@example.com'}],memberships:[{id:'ms',memberId:'m',planId:'p',planName:'Monthly',status:'active',startsAt:'2026-09-01T00:00:00Z',endsAt:'2026-09-27T12:00:00Z'}],schedule:[{id:'c',title:'Strength',room:'Studio',startsAt:'2026-09-21T12:00:00Z'}],bookings:[{id:'b',classId:'c',memberId:'m',status:'booked'}],notifications:[]};}
async function storage(state){const store=await createStore({memory:true});await store.mutate(s=>Object.assign(s,state));return store;}

test('expiry reminders deduplicate each threshold across workers and retained inbox removal',()=>{
 const s=fixture();assert.equal(createExpiryReminders(s,now),1);assert.equal(createExpiryReminders(s,now),0);
 s.notifications=[];assert.equal(createExpiryReminders(s,now),0);
 assert.equal(createExpiryReminders(s,new Date('2026-09-26T12:00:00Z')),1);
 assert.equal(createExpiryReminders(s,new Date('2026-09-27T13:00:00Z')),0);
});
test('timezone calendar days and catch-up use the most relevant threshold',()=>{
 const s=fixture();s.settings.timezone='America/Los_Angeles';s.memberships[0].endsAt='2026-09-22T01:00:00Z';
 assert.equal(createExpiryReminders(s,new Date('2026-09-20T23:00:00Z')),1);
 assert.match(s.notifications[0].title,/1 day/);assert.deepEqual(s.memberships[0].sentReminderThresholds,[1]);
});
test('renewal suppresses a queued expiry email and future reminders',()=>{
 const s=fixture();createExpiryReminders(s,now);assert.ok(shouldEmail(s,s.notifications[0],now));
 s.memberships.push({...s.memberships[0],id:'renewal',startsAt:s.memberships[0].endsAt,endsAt:'2026-10-27T12:00:00Z'});
 assert.equal(shouldEmail(s,s.notifications[0],now),false);assert.equal(createExpiryReminders(s,now),0);
});
test('booking cancellation suppresses confirmation and email preference is respected',()=>{
 const s=fixture(),b=s.bookings[0];notifyBooking(s,b,false,now);notifyBooking(s,b,false,now);assert.equal(s.notifications.length,1);
 b.status='cancelled';notifyBooking(s,b,true,now);assert.equal(shouldEmail(s,s.notifications[0],now),false);assert.equal(shouldEmail(s,s.notifications[1],now),true);
 s.members[0].notificationPreferences={bookingEmails:false};assert.equal(shouldEmail(s,s.notifications[1],now),false);
});
test('worker retries temporary failures only when due, persists success, and does not resend',async()=>{
 const s=fixture();s.memberships=[];notifyBooking(s,s.bookings[0],false,now);const store=await storage(s);let time=now,calls=0;
 const sender={config:{enabled:true},send:async()=>{if(++calls===1)throw Object.assign(new Error('private provider detail'),{code:'ETIMEDOUT'});return 'id';}};
 const worker=createNotificationWorker({store,sender,clock:()=>time});await worker.tick();assert.equal((await store.read()).notifications[0].email.status,'retry');
 await worker.tick();assert.equal(calls,1);time=new Date(now.getTime()+61000);await worker.tick();await worker.tick();assert.equal(calls,2);assert.equal((await store.read()).notifications[0].email.status,'sent');
});
test('concurrent workers claim each queued email once',async()=>{
 const s=fixture();s.memberships=[];notifyBooking(s,s.bookings[0],false,now);const store=await storage(s);let calls=0;
 const sender={config:{enabled:true},send:async()=>{calls++;await new Promise(r=>setTimeout(r,15));return 'id';}};
 await Promise.all([createNotificationWorker({store,sender,clock:()=>now}).tick(),createNotificationWorker({store,sender,clock:()=>now}).tick()]);assert.equal(calls,1);
});
test('worker recovers expired delivery leases without taking live leases',async()=>{
 const s=fixture();s.memberships=[];notifyBooking(s,s.bookings[0],false,now);
 Object.assign(s.notifications[0].email,{status:'sending',attempts:1,token:'old-worker',leaseUntil:new Date(now.getTime()+300000).toISOString()});
 const store=await storage(s);let time=now,calls=0;
 const worker=createNotificationWorker({store,clock:()=>time,sender:{config:{enabled:true},send:async()=>{calls++;return 'recovered';}}});
 await worker.tick();assert.equal(calls,0);time=new Date(now.getTime()+300001);await worker.tick();assert.equal(calls,1);
 const email=(await store.read()).notifications[0].email;assert.equal(email.status,'sent');assert.equal(email.attempts,2);assert.equal(email.token,undefined);
});
test('disabled delivery preserves inbox and permanent errors stop retries',async()=>{
 const store=await storage(fixture());await createNotificationWorker({store,sender:{config:{enabled:false}},clock:()=>now}).tick();assert.equal((await store.read()).notifications[0].email.status,'not-configured');
 await store.mutate(s=>{s.notifications[0].email.status='queued';});let calls=0;
 const worker=createNotificationWorker({store,clock:()=>now,sender:{config:{enabled:true},send:async()=>{calls++;throw Object.assign(new Error('secret'),{code:'EAUTH'});}}});
 await worker.tick();await worker.tick();assert.equal(calls,1);assert.equal((await store.read()).notifications[0].email.status,'failed');
});
test('member inbox excludes others and hides delivery internals; read endpoints enforce ownership',async()=>{
 const store=await createStore({memory:true}),client=request.agent(createApp({store}));
 await client.post('/api/auth/demo').send({role:'member'}).expect(200);const {body:state}=await client.get('/api/state');
 await store.mutate(s=>{s.notifications=[{id:'mine',memberId:state.user.memberId,createdAt:now.toISOString(),email:{status:'sent',token:'secret'}},{id:'other',memberId:'foreign',createdAt:now.toISOString(),email:{status:'sent'}}];});
 const {body}=await client.get('/api/notifications').expect(200);assert.equal(body.notifications.length,1);assert.equal(body.notifications[0].email,undefined);
 await client.post('/api/notifications/other/read').send({}).expect(404);await client.post('/api/notifications/mine/read').send({}).expect(200);
 await client.patch('/api/notifications/preferences').send({bookingEmails:false,expiryEmails:true}).expect(200);
 await client.post('/api/notifications/reminders').send({}).expect(403);
 assert.equal(notificationsFor(await store.read(),{role:'trainer'}).length,0);
});
test('Brevo requires explicit enabling and email templates escape user content',()=>{
 const env={EMAIL_ENABLED:'true',SMTP_USER:'login',SMTP_PASS:'test-only',EMAIL_FROM:'sender@example.com'};assert.equal(emailConfiguration(env).enabled,true);assert.equal(emailConfiguration(env,true).enabled,false);assert.equal(emailConfiguration({...env,SMTP_PASS:''}).enabled,false);
 const s=fixture();notifyBooking(s,s.bookings[0],false,now);s.notifications[0].body='<script>bad</script>';
 const content=emailContent({notification:s.notifications[0],member:s.members[0],settings:s.settings,appUrl:'https://example.com'});assert.ok(!content.html.includes('<script>'));assert.match(content.html,/&lt;script&gt;/);assert.match(content.text,/#schedule/);
});
