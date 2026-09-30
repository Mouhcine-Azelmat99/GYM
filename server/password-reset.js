import {randomUUID,createHmac,createHash} from 'node:crypto';
import {fail,hash} from './domain.js';
import {addNotification} from './notifications.js';
export const resetToken=(id,secret)=>createHmac('sha256',secret).update('password-reset:'+id).digest('hex');
const digest=token=>createHash('sha256').update(token).digest('hex');
export function requestPasswordReset(state,email,secret,now=new Date()){
  const user=state.users.find(u=>u.email.toLowerCase()===email.toLowerCase());
  if(!user?.passwordHash)return;
  state.passwordResets??=[];
  const previous=state.passwordResets.find(r=>r.userId===user.id);
  if(previous&&now-new Date(previous.createdAt)<60000)return;
  state.passwordResets=state.passwordResets.filter(r=>r.userId!==user.id);
  const id=randomUUID();
  state.passwordResets.push({id,userId:user.id,email:user.email,tokenHash:digest(resetToken(id,secret)),createdAt:now.toISOString(),expiresAt:new Date(+now+1800000).toISOString(),status:'pending',sessionVersion:user.sessionVersion||0});
  const notification=addNotification(state,{key:'password-reset:'+id,memberId:user.memberId||'user:'+user.id,type:'password-reset',title:'Reset your password',body:'Use this link to choose a new password. It expires in 30 minutes. If you did not request a password reset, you can ignore this email.',target:'profile',referenceId:id},now);
  notification.accountUserId=user.id;
}
export function validReset(state,notification,now=new Date()){
  const user=state.users.find(u=>u.id===notification.accountUserId);
  return Boolean(user&&(state.passwordResets||[]).some(r=>r.id===notification.referenceId&&r.userId===user.id&&r.email===user.email&&r.sessionVersion===(user.sessionVersion||0)&&r.status==='pending'&&new Date(r.expiresAt)>now));
}
export function finishPasswordReset(state,token,password,now=new Date()){
  const reset=(state.passwordResets||[]).find(r=>r.tokenHash===digest(token)&&r.status==='pending'&&new Date(r.expiresAt)>now);
  const user=reset&&state.users.find(u=>u.id===reset.userId&&u.email===reset.email&&(u.sessionVersion||0)===reset.sessionVersion);
  if(!user)fail('This reset link is invalid or expired. Request a new one.');
  user.passwordHash=hash(password);user.sessionVersion=(user.sessionVersion||0)+1;
  reset.status='used';delete reset.tokenHash;
}
