import {test} from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {createApp} from '../server/app.js';
import {createStore} from '../server/store.js';
import {allowedOrigins} from '../server/origins.js';
import {bootstrapOwner} from '../server/bootstrap-owner.js';
import {verify} from '../server/domain.js';

test('configured credentials initialize the demo owner and authenticate',async()=>{
  const store=await createStore({memory:true});
  const env={OWNER_EMAIL:'  OWNER-TEST@example.com  ',OWNER_PASSWORD:'Owner-test-password-123'};
  await bootstrapOwner(store,{demo:true,env});
  const client=request.agent(createApp({store}));
  await client.post('/api/auth/login').set('Origin','http://127.0.0.1:5173').send({email:'owner-test@example.com',password:env.OWNER_PASSWORD}).expect(200);
  const {body}=await client.get('/api/state').expect(200);
  assert.equal(body.user.role,'owner');assert.equal(body.user.id,'owner');
  await client.post('/api/auth/login').send({email:'owner-test@example.com',password:'Incorrect-password'}).expect(401);
});
test('bootstrap preserves existing credentials and allows passwordless demo without configuration',async()=>{
  const store=await createStore({memory:true});
  await bootstrapOwner(store,{demo:true,env:{}});
  assert.equal((await store.read()).users.find(u=>u.role==='owner').passwordHash,undefined);
  const env={OWNER_EMAIL:'bootstrap@example.com',OWNER_PASSWORD:'Original-password-123'};
  await bootstrapOwner(store,{demo:true,env});
  await bootstrapOwner(store,{demo:true,env:{OWNER_EMAIL:'changed@example.com',OWNER_PASSWORD:'Changed-password-123'}});
  const owner=(await store.read()).users.find(u=>u.role==='owner');
  assert.equal(owner.email,env.OWNER_EMAIL);assert.ok(verify(env.OWNER_PASSWORD,owner.passwordHash));
});
test('bootstrap rejects incomplete credentials without modifying accounts',async()=>{
  const store=await createStore({memory:true});
  await assert.rejects(bootstrapOwner(store,{demo:true,env:{OWNER_EMAIL:'test@example.com'}}),/initialize the owner/);
  assert.equal((await store.read()).users.find(u=>u.role==='owner').passwordHash,undefined);
});

test('development permits loopback aliases only on the configured port',()=>{
  const origins=allowedOrigins('http://127.0.0.1:5173',false);
  for(const origin of ['http://localhost:5173','http://127.0.0.1:5173','http://[::1]:5173'])assert.ok(origins.has(origin));
  for(const origin of ['http://localhost:5174','https://localhost:5173','http://localhost.evil.example:5173','null'])assert.ok(!origins.has(origin));
});
test('production permits only the configured origin',()=>{
  assert.deepEqual([...allowedOrigins('https://gym.example/path',true)],['https://gym.example']);
  assert.deepEqual([...allowedOrigins('http://127.0.0.1:5173',true)],['http://127.0.0.1:5173']);
});
test('register, logout, login and session work from localhost',async()=>{
  const store=await createStore({memory:true});const app=createApp({store});const client=request.agent(app);
  const credentials={email:'auth-test@example.com',password:'Test-only-password-123'};
  await client.post('/api/auth/register').set('Origin','http://localhost:5173').send({...credentials,name:'Auth Test'}).expect(201);
  await client.post('/api/auth/logout').set('Origin','http://localhost:5173').send({}).expect(200);
  await client.get('/api/state').expect(401);
  await client.post('/api/auth/login').set('Origin','http://localhost:5173').send(credentials).expect(200);
  const {body}=await client.get('/api/state').expect(200);assert.equal(body.user.email,credentials.email);assert.equal(body.user.role,'member');
  assert.equal(body.members.length,1);assert.ok(body.users.every(u=>!('passwordHash' in u)));
});
test('untrusted origins are rejected before authentication',async()=>{
  const store=await createStore({memory:true});const app=createApp({store});
  await request(app).post('/api/auth/login').set('Origin','https://evil.example').send({email:'a@example.com',password:'test'}).expect(403);
  await request(app).post('/api/auth/demo').set('Origin','http://127.0.0.1:5173').send({role:'owner'}).expect(200);
});
