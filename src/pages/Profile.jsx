import {useState} from 'react';
import {Avatar,Panel} from '../components/ui';

export default function Profile({state,act}){
  const member=state.members.find(m=>m.id===state.user.memberId)||state.user;
  const preferences=state.notificationPreferences||{};
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function change(key,value){
    setBusy(true);setError('');
    try{
      const result=await act('/notifications/preferences',{bookingEmails:preferences.bookingEmails!==false,expiryEmails:preferences.expiryEmails!==false,[key]:value},'Email preferences saved',undefined,'PATCH',true);
      if(result?.error)setError(result.error);
    }finally{setBusy(false);}
  }
  return <><div className="page-heading"><div><h1>My profile</h1><p>Your member details and email preferences.</p></div></div>
    <div className="member-profile-grid"><Panel title="Member details"><div className="profile-identity"><Avatar name={member.name}/><div><h2>{member.name}</h2><p>Member at {state.settings.name}</p></div></div><dl className="profile-fields"><div><dt>Email address</dt><dd>{member.email}</dd></div><div><dt>Phone number</dt><dd>{member.phone||'Not provided'}</dd></div><div><dt>Member since</dt><dd>{member.joinedAt?new Date(member.joinedAt).toLocaleDateString():'Not available'}</dd></div></dl><p className="quiet">Contact reception to update your member details.</p></Panel>
    <Panel title="Email preferences"><p>Choose which activity updates you receive by email. All updates remain in your notification inbox.</p>{error&&<p className="form-error" role="alert">{error}</p>}<div className="notification-preferences" aria-busy={busy}>{[['bookingEmails','Booking updates','Confirmations and cancellations for your classes.'],['expiryEmails','Membership expiry reminders','Reminders before your membership expires.']].map(([key,label,description])=><label key={key}><input type="checkbox" checked={preferences[key]!==false} disabled={busy} onChange={e=>change(key,e.target.checked)}/><span><strong>{label}</strong><small>{description}</small></span></label>)}</div><p className="form-note">Account creation, membership confirmations, and payment receipts are always emailed when email delivery is available.</p></Panel></div>
  </>;
}
