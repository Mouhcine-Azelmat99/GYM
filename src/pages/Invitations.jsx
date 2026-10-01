import {locale} from "../i18n";
import {useTranslation} from 'react-i18next';
import {useState} from 'react';
import {Panel,Button,SearchBox,Empty,Status} from '../components/ui';
export default function Invitations({state,act}){const {t}=useTranslation();
  const [search,setSearch]=useState(''),[busy,setBusy]=useState(null),[demoUrl,setDemoUrl]=useState('');
  async function send(member,revoke=false){setBusy(member.id);setDemoUrl('');try{const result=await act(`/members/${member.id}/invitation${revoke?'/revoke':''}`,{},revoke?"Invitation revoked":state.demo?"Demo invitation created":"Invitation queued for email");if(result.demoUrl)setDemoUrl(result.demoUrl);}finally{setBusy(null);}}
  const rows=state.members.filter(m=>(m.name+' '+m.email).toLowerCase().includes(search.toLowerCase()));
  return <><div className="page-heading"><div><h1>{t("Member invitations")}</h1><p>{t("Give existing members access to their portal. Links expire after 48 hours.")}</p></div></div>
    {state.demo&&<p className="form-note">{t("Demo invitations show a test link here. No email is sent.")}</p>}
    {!state.demo&&!state.notificationEmail?.enabled&&<p className="form-error">{t(state.notificationEmail?.reason||'')}</p>}
    {demoUrl&&<Panel title={t("Demo invitation")}><a href={demoUrl}>{t("Open password setup")}</a></Panel>}
    <Panel><SearchBox value={search} onChange={setSearch}/><div className="table-scroll"><table><thead><tr><th>{t("Member")}</th><th>{t("Portal access")}</th><th>{t("Email")}</th><th>{t("Expires")}</th><th>{t("Action")}</th></tr></thead><tbody>{rows.map(m=><tr key={m.id}><td><strong><bdi>{m.name}</bdi></strong><small className="cell-sub"><bdi>{m.email}</bdi></small></td><td><Status value={m.portalStatus}/></td><td>{m.invitationEmailStatus==='sent'?t("Accepted by Brevo"):t(m.invitationEmailStatus||'—')}</td><td>{m.invitationExpiresAt?new Date(m.invitationExpiresAt).toLocaleString(locale()):'—'}</td><td>{m.portalStatus!=='active'&&<div className="notification-actions"><Button disabled={!!busy||(!state.demo&&!state.notificationEmail?.enabled)} onClick={()=>send(m)}>{busy===m.id?t("Working…"):m.portalStatus==='not invited'?t("Invite member"):t("Resend invitation")}</Button>{m.portalStatus==='invited'&&<Button variant="danger-text" disabled={!!busy} onClick={()=>send(m,true)}>{t("Revoke")}</Button>}</div>}</td></tr>)}</tbody></table>{!rows.length&&<Empty>{t("No members found. Add a member from Members first.")}</Empty>}</div></Panel></>;
}
