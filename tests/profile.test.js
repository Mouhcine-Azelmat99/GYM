import {test} from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
import {createStore} from '../server/store.js';

async function fixture(){const store=await createStore({memory:true});const app=createApp({store}),client=request.agent(app);await client.post('/api/auth/register').send({name:'Profile Member',email:'profile@example.com',password:'Profile-password-123'}).expect(201);return {store,app,client};}
const details={name:'Updated Name',phone:'+212 600 000000',email:'profile@example.com'};
test('profile updates are scoped to the member and synchronize login identity',async()=>{
 const {client,store}=await fixture();const before=await store.read();
 await client.patch('/api/profile').send({...details,memberId:'member-1'}).expect(400);
 await client.patch('/api/profile').send(details).expect(200);
 const {body}=await client.get('/api/state');assert.equal(body.user.name,details.name);assert.equal(body.members[0].phone,details.phone);
 assert.deepEqual((await store.read()).members.find(m=>m.id==='member-1'),before.members.find(m=>m.id==='member-1'));
 await client.patch('/api/profile').send({...details,name:'   '}).expect(400);
});
test('email changes require current password, reject duplicates, and update login',async()=>{
 const {client,store}=await fixture();
 await client.patch('/api/profile').send({...details,email:'new@example.com'}).expect(403);
 await client.patch('/api/profile').send({...details,email:'new@example.com',currentPassword:'wrong'}).expect(403);
 const duplicate=(await store.read()).members[0].email;
 await client.patch('/api/profile').send({...details,email:duplicate,currentPassword:'Profile-password-123'}).expect(409);
 await client.patch('/api/profile').send({...details,email:' NEW@example.com ',currentPassword:'Profile-password-123'}).expect(200);
 await client.post('/api/auth/logout').send({}).expect(200);
 await client.post('/api/auth/login').send({email:'profile@example.com',password:'Profile-password-123'}).expect(401);
 await client.post('/api/auth/login').send({email:'new@example.com',password:'Profile-password-123'}).expect(200);
});
test('photo uploads normalize to a small metadata-free JPEG, persist, and can be removed',async()=>{
 const {client,store}=await fixture();
 const input=await sharp({create:{width:400,height:300,channels:3,background:'#aabbcc'}}).png().withMetadata().toBuffer();
 await client.put('/api/profile/photo').send({photo:'data:image/png;base64,'+input.toString('base64')}).expect(200);
 const {body}=await client.get('/api/state');const saved=body.members[0].photo;assert.ok(saved.startsWith('data:image/jpeg;base64,'));
 const metadata=await sharp(Buffer.from(saved.split(',')[1],'base64')).metadata();assert.equal(metadata.width,256);assert.equal(metadata.height,256);assert.equal(metadata.exif,undefined);
 assert.equal((await store.read()).members.find(m=>m.id===body.user.memberId).photo,saved);
 await client.put('/api/profile/photo').send({photo:null}).expect(200);assert.equal((await client.get('/api/state')).body.members[0].photo,null);
});
test('photo endpoint rejects malformed, oversized, SVG and unauthenticated uploads',async()=>{
 const {client,app}=await fixture();
 for(const photo of ['data:image/png;base64,YmFk','data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=','https://example.com/photo.png','data:image/png;base64,'+'A'.repeat(2800000)])await client.put('/api/profile/photo').send({photo}).expect(400);
 await request(app).put('/api/profile/photo').send({photo:null}).expect(401);
 await client.post('/api/auth/demo').send({role:'owner'}).expect(200);
 await client.put('/api/profile/photo').send({photo:null}).expect(403);
 await client.patch('/api/profile').send(details).expect(403);
});
