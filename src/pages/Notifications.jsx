import {useState} from 'react';
import {Button,Panel,Empty} from '../components/ui';

const delivery={sent:'Accepted by Brevo',queued:'Queued',sending:'Sending',retry:'Retry scheduled',failed:'Failed',skipped:'Skipped','not-configured':'Email unavailable'};
export default function Notifications({state,act,navigate}){
  const member=state.user.role==='member',owner=state.user.role==='owner';
  const [unreadOnly,setUnreadOnly]=useState(false),[busy,setBusy]=useState(false);
  const notifications=state.notifications||[];
  async function run(path,body,message,method){setBusy(true);try{return await act(path,body,message,undefined,method);}finally{setBusy(false);}}
  return <><div className="page-heading"><div><h1>{member?'Notifications':'Notification activity'}</h1><p className="quiet">Account, membership, payment, and booking updates.</p></div></div>
    {owner&&!state.notificationEmail?.enabled&&<p className="quiet" role="status">Brevo SMTP: {state.notificationEmail?.reason} See docs/notifications.md for setup.</p>}
    <Panel title={member?'Your inbox':'Recent activity'} action={member?<Button disabled={busy||!notifications.some(n=>!n.readAt)} onClick={()=>run('/notifications/read-all',{},'All notifications marked as read')}>Mark all as read</Button>:owner?<Button disabled={busy} onClick={()=>run('/notifications/reminders',{},'Expiry reminders checked')}>Check expiry reminders</Button>:null}>
      {member&&<div className="notification-toolbar"><Button aria-pressed={!unreadOnly} onClick={()=>setUnreadOnly(false)}>All</Button><Button aria-pressed={unreadOnly} onClick={()=>setUnreadOnly(true)}>Unread ({notifications.filter(n=>!n.readAt).length})</Button></div>}
      {notifications.filter(n=>!member||!unreadOnly||!n.readAt).map(n=><article key={n.id} className={'notification-item '+(member&&!n.readAt?'is-unread':'')}><div><div className="notification-meta">{!member&&<strong>{n.recipientName}</strong>}<time dateTime={n.createdAt}>{new Date(n.createdAt).toLocaleString()}</time>{member&&!n.readAt&&<span>Unread</span>}</div><h3>{n.title}</h3><p>{n.body}</p>{!member&&<small>{delivery[n.emailStatus]||n.emailStatus}{n.emailError?` · ${n.emailError}`:''}</small>}</div><div className="notification-actions">{member&&<><Button onClick={()=>navigate(n.target)}>View</Button>{!n.readAt&&<Button disabled={busy} onClick={()=>run(`/notifications/${n.id}/read`,{},'Marked as read')}>Mark as read</Button>}</>}{owner&&state.notificationEmail?.enabled&&['failed','not-configured'].includes(n.emailStatus)&&<Button disabled={busy} onClick={()=>run(`/notifications/${n.id}/retry`,{},'Email queued for retry')}>Retry email</Button>}</div></article>)}
      {!notifications.some(n=>!member||!unreadOnly||!n.readAt)&&<Empty>{unreadOnly?'You’re all caught up.':'No notifications yet.'}</Empty>}
    </Panel></>;
}
