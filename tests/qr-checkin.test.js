import {test} from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
import {createStore} from '../server/store.js';
import {memberCheckIn,readCheckInToken,scanCheckIn} from '../server/qr-checkin.js';

test('QR tokens expire, reject tampering, and roundtrip through a QR image',async()=>{
 const store=await createStore({memory:true}),s=await store.read(),now=new Date();const data=memberCheckIn(s,'member-5','test-key',now);
 assert.ok(data.token);assert.equal(readCheckInToken(data.token,'test-key',now),'member-5');
 assert.throws(()=>readCheckInToken(data.token,'wrong-key',now),/Invalid/);
 assert.throws(()=>readCheckInToken(data.token,'test-key',new Date(+now+90000)),/expired/);
 assert.throws(()=>readCheckInToken(data.token+'x','test-key',now),/Invalid/);
 assert.throws(()=>readCheckInToken('member-5','test-key'),/Invalid/);
 const buffer=await QRCode.toBuffer(data.token,{width:640,margin:4});const {data:pixels,info}=await sharp(buffer).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const decoded=jsQR(new Uint8ClampedArray(pixels),info.width,info.height);assert.equal(decoded.data,data.token);
});
test('QR scan checks current eligibility and concurrent scans record one visit and audit actor',async()=>{
 const store=await createStore({memory:true}),s=await store.read();const qr=memberCheckIn(s,'member-5','test-key');
 const scans=await Promise.allSettled([store.mutate(s=>scanCheckIn(s,qr.token,'test-key','owner')),store.mutate(s=>scanCheckIn(s,qr.token,'test-key','owner'))]);
 assert.equal(scans.filter(r=>r.status==='fulfilled').length,1);const updated=await store.read();assert.equal(updated.attendance.filter(a=>a.memberId==='member-5').length,1);
 assert.equal(updated.attendance[0].source,'qr');assert.equal(updated.attendance[0].checkedBy,'owner');assert.equal(memberCheckIn(updated,'member-5','test-key').token,null);
 const another=memberCheckIn(updated,'member-7','test-key');await store.mutate(s=>{s.memberships.find(m=>m.memberId==='member-7').endsAt=new Date(Date.now()-1000).toISOString();});
 await assert.rejects(store.mutate(s=>scanCheckIn(s,another.token,'test-key','owner')),/no active gym access/);
 assert.equal(memberCheckIn(updated,'member-4','test-key').eligible,false);assert.equal(memberCheckIn(updated,'member-6','test-key').eligible,false);
});
test('monthly attendance and duplicate-day state use the gym timezone',async()=>{
 const s=await (await createStore({memory:true})).read();s.settings.timezone='America/New_York';s.attendance=[
 {memberId:'member-5',createdAt:'2026-04-01T02:00:00Z'},
 {memberId:'member-5',createdAt:'2026-04-01T05:00:00Z'},
 {memberId:'member-5',createdAt:'2026-04-02T05:00:00Z'},
 {memberId:'member-2',createdAt:'2026-04-01T05:00:00Z'}];
 const data=memberCheckIn(s,'member-5','key',new Date('2026-04-01T12:00:00Z'));
 assert.equal(data.month,'2026-04');assert.equal(data.monthlyAttendance,1);assert.equal(data.checkedInToday,true);
});
test('only members get their own QR; only owner/reception can scan',async()=>{
 const store=await createStore({memory:true}),app=createApp({store}),member=request.agent(app),owner=request.agent(app),trainer=request.agent(app);
 await store.mutate(s=>{s.attendance=[];});
 await member.post('/api/auth/demo').send({role:'member'});await owner.post('/api/auth/demo').send({role:'owner'});await trainer.post('/api/auth/demo').send({role:'trainer'});
 const response=await member.get('/api/attendance/qr?memberId=member-5').expect(200);assert.equal(response.headers['cache-control'],'no-store');const token=response.body.token;
 await request(app).get('/api/attendance/qr').expect(401);await owner.get('/api/attendance/qr').expect(403);await trainer.post('/api/attendance/scan').send({token}).expect(403);await member.post('/api/attendance/scan').send({token}).expect(403);
 const result=await owner.post('/api/attendance/scan').send({token}).expect(200);assert.equal(result.body.member.id,'member-1');assert.equal(result.body.monthlyAttendance,1);
  await owner.post('/api/attendance').send({memberId:'member-5'}).expect(201);
  const personal=(await member.get('/api/state').expect(200)).body;assert.equal(personal.attendance.length,1);assert.ok(personal.attendance.every(a=>a.memberId===personal.user.memberId));
 await owner.post('/api/attendance/scan').send({token}).expect(400);
 const s=await store.read();assert.equal(s.auditLogs.at(-1).actorId,'owner');assert.ok(!JSON.stringify(s.auditLogs).includes(token));
});
