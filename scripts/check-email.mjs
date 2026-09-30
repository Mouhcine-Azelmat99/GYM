import 'dotenv/config';
import {createEmailSender} from '../server/email.js';
const sender=createEmailSender(process.env,process.env.DEMO_MODE!=='false');
if(!sender.config.enabled){console.error(sender.config.reason);process.exitCode=1;}
else try{await sender.verify();console.log('Brevo SMTP connection and authentication verified. No email was sent.');}
catch(error){
  console.error('Brevo SMTP verification failed.',{code:error.code||'SMTP_ERROR',responseCode:Number.isInteger(error.responseCode)?error.responseCode:undefined});
  if(error.responseCode===525) console.error('Brevo blocked the connection IP. Authorize the public outbound IP shown in Brevo Security > Authorized IPs, not a private LAN address.');
  else if(error.code==='EAUTH') console.error('Check the exact Brevo SMTP login and active SMTP key. Also check Brevo Security > Authorized IPs for a blocked connection.');
  process.exitCode=1;
}
