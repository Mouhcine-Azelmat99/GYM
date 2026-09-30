import {randomUUID,createHmac,createHash} from 'node:crypto';
import {fail,find,hash} from './domain.js';
import {addNotification} from './notifications.js';
export const invitationToken=(id,secret)=>createHmac('sha256',secret).update('member-invitation:'+id).digest('hex');
const digest=token=>createHash('sha256').update(token).digest('hex');
export function issueInvitation(state,memberId,secret,now=new Date()){
  const member=find(state.members,memberId);
  if(state.users.some(u=>u.memberId===memberId||u.email.toLowerCase()===member.email.toLowerCase()))fail('This member already has an account or the email belongs to another account.');
  state.invitations??=[];
  const previous=state.invitations.find(i=>i.memberId===memberId&&i.status==='pending');
  if(previous&&now-new Date(previous.createdAt)<60000)fail('Wait one minute before resending an invitation.',429);
  for(const i of state.invitations)if(i.memberId===memberId&&i.status==='pending')i.status='revoked';
  // Keep only the newest invitation per member; old tokens remain invalid.
  state.invitations=state.invitations.filter(i=>i.memberId!==memberId);
  const id=randomUUID(),token=invitationToken(id,secret);
  const invitation={id,memberId,email:member.email,tokenHash:digest(token),status:'pending',createdAt:now.toISOString(),expiresAt:new Date(+now+48*3600000).toISOString()};
  state.invitations.push(invitation);
  addNotification(state,{key:'invitation:'+id,memberId,type:'member-invitation',title:'You’re invited to '+state.settings.name,body:'Set your password to access your memberships, payments, and bookings. This invitation expires in 48 hours.',target:'profile',referenceId:id},now);
  return {id,token,expiresAt:invitation.expiresAt};
}
export function acceptInvitation(state,token,password,now=new Date()){
  const invitation=(state.invitations||[]).find(i=>i.tokenHash===digest(token)&&i.status==='pending'&&new Date(i.expiresAt)>now);
  if(!invitation)fail('This invitation is invalid or expired. Ask reception for a new invitation.');
  const member=find(state.members,invitation.memberId);
  if(member.email!==invitation.email||state.users.some(u=>u.memberId===member.id||u.email.toLowerCase()===member.email.toLowerCase()))fail('This invitation is no longer available.');
  const user={id:randomUUID(),memberId:member.id,name:member.name,email:member.email,role:'member',passwordHash:hash(password)};
  state.users.push(user);invitation.status='accepted';invitation.acceptedAt=now.toISOString();delete invitation.tokenHash;
  return user;
}
