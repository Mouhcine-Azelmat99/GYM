import {useState} from 'react';
import {Panel,Button,SearchBox,Empty,Status} from '../components/ui';
export default function Invitations({state,act}){
  const [search,setSearch]=useState(''),[busy,setBusy]=useState(null),[demoUrl,setDemoUrl]=useState('');
  async function send(member,revoke=false){setBusy(member.id);setDemoUrl('');try{const result=await act(`/members/${member.id}/invitation${revoke?'/revoke':''}`,{},revoke?'Invitation revoked':state.demo?'Demo invitation created':'Invitation queued for email');if(result.demoUrl)setDemoUrl(result.demoUrl);}finally{setBusy(null);}}
  const rows=state.members.filter(m=>(m.name+' '+m.email).toLowerCase().includes(search.toLowerCase()));
  return <><div className="page-heading"><div><h1>Member invitations</h1><p>Give existing members access to their portal. Links expire after 48 hours.</p></div></div>
    {state.demo&&<p className="form-note">Demo invitations show a test link here. No email is sent.</p>}
    {!state.demo&&!state.notificationEmail?.enabled&&<p className="form-error">{state.notificationEmail?.reason}</p>}
    {demoUrl&&<Panel title="Demo invitation"><a href={demoUrl}>Open password setup</a></Panel>}
    <Panel><SearchBox value={search} onChange={setSearch}/><div className="table-scroll"><table><thead><tr><th>Member</th><th>Portal access</th><th>Email</th><th>Expires</th><th>Action</th></tr></thead><tbody>{rows.map(m=><tr key={m.id}><td><strong>{m.name}</strong><small className="cell-sub">{m.email}</small></td><td><Status value={m.portalStatus}/></td><td>{m.invitationEmailStatus==='sent'?'Accepted by Brevo':m.invitationEmailStatus||'—'}</td><td>{m.invitationExpiresAt?new Date(m.invitationExpiresAt).toLocaleString():'—'}</td><td>{m.portalStatus!=='active'&&<div className="notification-actions"><Button disabled={!!busy||(!state.demo&&!state.notificationEmail?.enabled)} onClick={()=>send(m)}>{busy===m.id?'Working…':m.portalStatus==='not invited'?'Invite member':'Resend invitation'}</Button>{m.portalStatus==='invited'&&<Button variant="danger-text" disabled={!!busy} onClick={()=>send(m,true)}>Revoke</Button>}</div>}</td></tr>)}</tbody></table>{!rows.length&&<Empty>No members found. Add a member from Members first.</Empty>}</div></Panel></>;
}
