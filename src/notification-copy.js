import {locale,t} from './i18n.js';
import {money} from './api.js';

// Snapshot values describe the event, even if its plan or session is edited later.
export function notificationCopy(notification) {
  if(!notification.translation)return {title:t(notification.title),body:t(notification.body)};
  const values=Object.fromEntries(Object.entries(notification.translation.values||{}).map(([key,value])=>{
    if(value&&typeof value==='object') {
      if(value.date)value=new Intl.DateTimeFormat(locale(),{dateStyle:'long',...(value.withTime?{timeStyle:'short'}:{}),timeZone:value.timeZone}).format(new Date(value.date));
      else if(value.currency)value=money(value.amount,value.currency);
      else if(value.label)value=t(value.label);
      else if(value.unit)value=t(value.unit,{count:value.count});
    }
    return [key,value];
  }));
  return {title:t(notification.translation.title,values),body:t(notification.translation.body,values)};
}
