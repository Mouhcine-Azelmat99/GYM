import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import ar from './locales/ar.js';

export const languageKey = 'forma.language.v1';
export function supportedLanguage(value) { return /^ar(?:-|$)/i.test(value || '') ? 'ar' : 'en'; }
export function initialLanguage() {
  try { const saved = localStorage.getItem(languageKey); if (saved === 'en' || saved === 'ar') return saved; } catch { /* Storage can be disabled. */ }
  return supportedLanguage(typeof navigator === 'undefined' ? 'en' : navigator.language);
}
const en = Object.fromEntries(Object.keys(ar).filter(key=>! /_(zero|one|two|few|many|other)$/.test(key)).map(key => [key, key.startsWith('audit.')?key.slice(6):key]));
Object.assign(en, {
  'visits_zero':'No visits', 'visits_one':'{{count}} visit', 'visits_other':'{{count}} visits',
  'days_one':'{{count}} day', 'days_other':'{{count}} days',
  'credits_one':'{{count}} session credit', 'credits_other':'{{count}} session credits',
  'members_one':'{{count}} member', 'members_other':'{{count}} members',
  'sessions_one':'{{count}} session', 'sessions_other':'{{count}} sessions',
  'transactions_one':'{{count}} transaction', 'transactions_other':'{{count}} transactions',
});
const languageLocale=language=>supportedLanguage(language)==='ar'?'ar-EG-u-ca-gregory-nu-latn':'en';
// English sentences are stable keys. Disable separators so punctuation is literal.
i18n.use({type:'formatter',init(){},format(value,format,language){
  if(typeof value==='number')return new Intl.NumberFormat(languageLocale(language)).format(value);
  // Isolate interpolated names and dates from the surrounding sentence direction.
  return typeof value==='string'?`\u2068${value}\u2069`:value;
}}).use(initReactI18next).init({
  resources:{en:{translation:en},ar:{translation:ar}},
  lng:initialLanguage(), fallbackLng:'en', supportedLngs:['en','ar'],
  keySeparator:false, nsSeparator:false, initImmediate:false,
  interpolation:{escapeValue:false,alwaysFormat:true}, react:{useSuspense:false},
});
export function applyLanguage(language) {
  const value=supportedLanguage(language);
  if(typeof document!=='undefined') {
    document.documentElement.lang=value;
    document.documentElement.dir=value==='ar'?'rtl':'ltr';
    document.title=value==='ar'?'Forma | إدارة النادي الرياضي':'Forma | Gym management';
  }
  try { localStorage.setItem(languageKey,value); } catch { /* Keep switching functional without storage. */ }
}
i18n.on('languageChanged',applyLanguage);
applyLanguage(i18n.language);
export const t=(key,options)=>i18n.t(key,options);
export const locale=()=>languageLocale(i18n.resolvedLanguage);
export const number=(value,options)=>new Intl.NumberFormat(locale(),options).format(value);
export default i18n;
