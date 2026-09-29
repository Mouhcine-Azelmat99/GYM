import {test} from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {createStore} from '../server/store.js';
import {createApp} from '../server/app.js';
import {book,cancelBooking,purchase,activate,checkIn} from '../server/domain.js';

test('cash confirmation activates once, preserves membership dates on retry',async()=>{
  const store=await createStore({memory:true});const app=createApp({store});const owner=request.agent(app);
  await owner.post('/api/auth/demo').send({role:'owner'}).expect(200);
  const first=await owner.post('/api/payments/payment-3/confirm').send({}).expect(200);
  const before=(await store.read()).memberships.find(m=>m.id==='membership-3');
  await owner.post('/api/payments/payment-3/confirm').send({}).expect(200);
  const after=(await store.read()).memberships.find(m=>m.id==='membership-3');
  assert.equal(first.body.status,'paid');assert.equal(after.status,'active');assert.equal(before.endsAt,after.endsAt);
  await owner.post('/api/payments/payment-2/confirm').send({}).expect(400);
});
test('members cannot confirm payments or read other members',async()=>{
  const store=await createStore({memory:true});const client=request.agent(createApp({store}));
  await client.post('/api/auth/demo').send({role:'member'}).expect(200);
  await client.post('/api/payments/payment-3/confirm').send({}).expect(403);
  await client.post('/api/bookings').send({memberId:'member-2',classId:'class-1'}).expect(403);
  const {body}=await client.get('/api/state').expect(200);assert.equal(body.members.length,1);assert.ok(body.payments.every(p=>p.memberId===body.user.memberId));
  await client.patch('/api/settings').send({}).expect(403);
});
test('concurrent reservations cannot exceed capacity or spend credits twice',async()=>{
  const store=await createStore({memory:true});await store.mutate(s=>{s.schedule[0].capacity=1;});
  const results=await Promise.allSettled([store.mutate(s=>book(s,'member-1','class-1')),store.mutate(s=>book(s,'member-7','class-1'))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const s=await store.read();assert.equal(s.bookings.length,1);assert.equal(s.memberships[0].credits+s.memberships[6].credits,23);
});
test('early cancellation returns one credit, repeated cancellation fails',async()=>{
  const store=await createStore({memory:true});await store.mutate(s=>{s.schedule[0].startsAt=new Date(Date.now()+86400000).toISOString();});
  const booking=await store.mutate(s=>book(s,'member-1','class-1'));
  const result=await store.mutate(s=>cancelBooking(s,booking.id));assert.equal(result.creditReturned,true);
  await assert.rejects(store.mutate(s=>cancelBooking(s,booking.id)),/Only an upcoming/);
  assert.equal((await store.read()).memberships[0].credits,12);
});
test('late cancellation retains spent credit; expired memberships cannot check in',async()=>{
  const store=await createStore({memory:true});await store.mutate(s=>{s.schedule[0].startsAt=new Date(Date.now()+3600000).toISOString();});
  const b=await store.mutate(s=>book(s,'member-1','class-1'));const result=await store.mutate(s=>cancelBooking(s,b.id));assert.equal(result.creditReturned,false);
  assert.equal((await store.read()).memberships[0].credits,11);
  await assert.rejects(store.mutate(s=>checkIn(s,'member-4')),/no active gym access/);
  await assert.rejects(store.mutate(s=>checkIn(s,'member-1')),/already checked in/);
});
test('renewal starts after current membership expiry; pending purchase blocks duplicates',async()=>{
  const store=await createStore({memory:true});const current=(await store.read()).memberships[0];
  const p=await store.mutate(s=>purchase(s,'member-1','plan-all','cash'));
  await assert.rejects(store.mutate(s=>purchase(s,'member-1','plan-all','cash')),/pending payment/);
  await store.mutate(s=>activate(s,p.id));const s=await store.read();const renewed=s.memberships.find(m=>m.id===p.membershipId);assert.equal(renewed.startsAt,current.endsAt);
});
