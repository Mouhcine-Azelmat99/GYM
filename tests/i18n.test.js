import test from 'node:test';
import assert from 'node:assert/strict';
import i18n,{t,number,initialLanguage,applyLanguage,languageKey,supportedLanguage} from '../src/i18n.js';
import {date,money} from '../src/api.js';
import {notificationCopy} from '../src/notification-copy.js';
import {notifyBooking,notifyPaymentConfirmed} from '../server/notifications.js';

test('language preference, document direction and unavailable browser storage',async()=>{
 const oldDocument=globalThis.document,oldStorage=globalThis.localStorage;
 try{
  const stored=new Map();globalThis.localStorage={getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value)};
  globalThis.document={documentElement:{},title:''};
  assert.equal(supportedLanguage('ar-MA'),'ar');assert.equal(supportedLanguage('fr'),'en');
  await i18n.changeLanguage('ar');assert.equal(document.documentElement.dir,'rtl');assert.equal(document.documentElement.lang,'ar');
  assert.equal(stored.get(languageKey),'ar');assert.equal(initialLanguage(),'ar');
  await i18n.changeLanguage('en');assert.equal(document.documentElement.dir,'ltr');assert.equal(initialLanguage(),'en');
  globalThis.localStorage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
  assert.doesNotThrow(()=>applyLanguage('ar'));assert.doesNotThrow(()=>initialLanguage());
 }finally{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;if(oldStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=oldStorage;await i18n.changeLanguage('en');}
});

test('Arabic plurals, numbers, Gregorian dates and English fallback',async()=>{
 await i18n.changeLanguage('ar');
 assert.equal(t('visits',{count:0}),'لا توجد زيارات');assert.equal(t('visits',{count:1}),'زيارة واحدة');assert.equal(t('visits',{count:2}),'زيارتان');
 assert.match(t('visits',{count:3}),/3 زيارات/);assert.match(t('visits',{count:11}),/11 زيارة/);assert.match(t('visits',{count:100}),/100 زيارة/);
 assert.equal(number(12),'12');assert.match(date('2026-10-01T12:00:00Z',{year:'numeric',timeZone:'UTC'}),/2026/);assert.match(money(1200,'USD'),/12/);
 const copy=t('Good to see you, {{name}}.',{name:'Sophia'});assert.match(copy,/\u2068Sophia\u2069/);
 assert.equal(t('Unknown future message'),'Unknown future message');
 await i18n.changeLanguage('en');assert.equal(t('visits',{count:1}),'1 visit');assert.equal(t('visits',{count:2}),'2 visits');assert.equal(t('days',{count:0}),'0 days');assert.equal(t('audit.created'),'created');
});

test('notification translations preserve original event snapshots and payment values',async()=>{
 const state={settings:{timezone:'UTC'},notifications:[],schedule:[{id:'c',title:'Strength',startsAt:'2026-10-05T12:00:00Z',room:'Studio A'}]};
 notifyBooking(state,{id:'b',classId:'c',memberId:'m'});
 state.schedule[0].title='Edited later';
 notifyPaymentConfirmed(state,{id:'p',memberId:'m',amount:1999,currency:'USD',description:'Monthly',method:'cash'},{id:'ms',memberId:'m',planName:'Monthly',startsAt:'2026-10-01T00:00:00Z',endsAt:'2026-11-01T00:00:00Z'});
 const before=JSON.stringify(state.notifications);
 await i18n.changeLanguage('ar');const booking=notificationCopy(state.notifications[0]);assert.equal(booking.title,'تم تأكيد حجزك');assert.ok(booking.body.includes('Strength'));assert.ok(!booking.body.includes('Edited later'));
 assert.match(notificationCopy(state.notifications[1]).body,/19.99/);
 assert.equal(JSON.stringify(state.notifications),before);
 await i18n.changeLanguage('en');assert.equal(notificationCopy(state.notifications[0]).title,'Your booking is confirmed');
});
