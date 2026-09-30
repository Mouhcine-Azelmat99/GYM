import {test} from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {createStore} from '../server/store.js';
import {createApp} from '../server/app.js';
import {hash,verify} from '../server/domain.js';
import {requestPasswordReset,finishPasswordReset,resetToken} from '../server/password-reset.js';
import {shouldEmail} from '../server/notifications.js';
import {createNotificationWorker} from '../server/notification-worker.js';
import {emailContent} from '../server/email.js';
const secret=process.env.SESSION_SECRET||'local-demo-only-not-for-production';
async function fixture(){const store=await createStore({memory:true});await store.mutate(s=>{s.users.find(u=>u.id==='owner').passwordHash=hash('Old-owner-password-123');});const app=createApp({store,emailConfig:{enabled:true,provider:'Test',reason:null}});return {store,app};}
test('reset requests are generic, secrets stay private, staff delivery works and sessions are revoked',async()=>{
 const {store,app}=await fixture(),first=request.agent(app),second=request.agent(app);
 for(const client of [first,second])await client.post('/api/auth/login').send({email:'owner@forma.example',password:'Old-owner-password-123'}).expect(200);
 const valid=await request(app).post('/api/auth/forgot-password').send({email:'owner@forma.example'}).expect(200);
 const unknown=await request(app).post('/api/auth/forgot-password').send({email:'unknown@example.com'}).expect(200);assert.deepEqual(valid.body,unknown.body);
 const s=await store.read(),r=s.passwordResets[0],token=resetToken(r.id,secret);assert.ok(!JSON.stringify(s).includes(token));
 const publicState=(await first.get('/api/state')).body;assert.equal(publicState.passwordResets,undefined);assert.ok(!JSON.stringify(publicState).includes('password-reset'));assert.ok(!JSON.stringify((await first.get('/api/notifications')).body).includes('password-reset'));
 let delivered;await createNotificationWorker({store,sender:{config:{enabled:true},send:async job=>{if(job.notification.type==='password-reset')delivered=job;return 'test';}}}).tick();assert.equal(delivered.member.email,'owner@forma.example');assert.equal(delivered.member.passwordHash,undefined);
 const content=emailContent({...delivered,appUrl:'https://gym.example',invitationSecret:secret});assert.ok(content.text.includes('#reset='+token));
 await request(app).post('/api/auth/reset-password').send({token,password:'New-owner-password-123'}).expect(200);
 await first.get('/api/state').expect(401);await second.get('/api/state').expect(401);
 await request(app).post('/api/auth/login').send({email:'owner@forma.example',password:'Old-owner-password-123'}).expect(401);
 await request(app).post('/api/auth/login').send({email:'owner@forma.example',password:'New-owner-password-123'}).expect(200);
 await request(app).post('/api/auth/reset-password').send({token,password:'Another-password-123'}).expect(400);
 const final=await store.read();assert.ok(!JSON.stringify(final.auditLogs).includes(token));assert.ok(final.auditLogs.some(e=>e.entity==='users'&&e.fields.includes('password')));
});
test('expiry, replacement, cooldown, changed email and concurrent consumption are enforced',async()=>{
 const {store}=await fixture();const now=new Date();await store.mutate(s=>requestPasswordReset(s,'owner@forma.example',secret,now));let s=await store.read();const first=s.passwordResets[0],oldToken=resetToken(first.id,secret);
 await store.mutate(s=>requestPasswordReset(s,'owner@forma.example',secret,new Date(+now+1000)));assert.equal((await store.read()).passwordResets[0].id,first.id);
 await assert.rejects(store.mutate(s=>finishPasswordReset(s,oldToken,'New-password-123',new Date(+now+1800000))),/invalid or expired/);
 await store.mutate(s=>requestPasswordReset(s,'owner@forma.example',secret,new Date(+now+61000)));s=await store.read();assert.equal(shouldEmail(s,s.notifications.find(n=>n.referenceId===first.id)),false);
 await assert.rejects(store.mutate(s=>finishPasswordReset(s,oldToken,'New-password-123')),/invalid or expired/);
 const token=resetToken(s.passwordResets[0].id,secret);
 await store.mutate(s=>{s.users.find(u=>u.id==='owner').email='changed@example.com';});
 await assert.rejects(store.mutate(s=>finishPasswordReset(s,token,'New-password-123')),/invalid or expired/);
 await store.mutate(s=>{s.users.find(u=>u.id==='owner').email='owner@forma.example';});
 const attempts=await Promise.allSettled([store.mutate(s=>finishPasswordReset(s,token,'New-password-123')),store.mutate(s=>finishPasswordReset(s,token,'Other-password-123'))]);assert.equal(attempts.filter(a=>a.status==='fulfilled').length,1);assert.ok(verify('New-password-123',(await store.read()).users.find(u=>u.id==='owner').passwordHash));
});
test('disabled delivery remains generic and reset endpoint validates inputs',async()=>{
 const store=await createStore({memory:true}),app=createApp({store});
 await request(app).post('/api/auth/forgot-password').send({email:'owner@forma.example'}).expect(200);assert.equal((await store.read()).passwordResets.length,0);
 await request(app).post('/api/auth/reset-password').send({token:'f'.repeat(64),password:'short'}).expect(400);
 await request(app).post('/api/auth/reset-password').send({token:'f'.repeat(64),password:'Long-password-123'}).expect(400);
});
