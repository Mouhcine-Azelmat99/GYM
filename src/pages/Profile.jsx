import {useState} from 'react';
import {Avatar,Panel,Button,Field} from '../components/ui';

export default function Profile({state,act}){
  const member=state.members.find(m=>m.id===state.user.memberId)||state.user;
  const preferences=state.notificationPreferences||{};
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [editing,setEditing]=useState(false),[form,setForm]=useState({}),[profileBusy,setProfileBusy]=useState(false),[profileError,setProfileError]=useState('');
  const [photo,setPhoto]=useState(undefined);
  function edit(){setForm({name:member.name,email:member.email,phone:member.phone||'',currentPassword:''});setPhoto(undefined);setProfileError('');setEditing(true);}
  async function choosePhoto(event){
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>2*1024*1024){setProfileError('Choose a JPEG, PNG, or WebP photo up to 2 MB.');return;}
    setProfileBusy(true);setProfileError('');
    try{const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});setPhoto(data);}
    catch{setProfileError('Could not read this photo. Try another image.');}finally{setProfileBusy(false);}
  }
  async function save(event){
    event.preventDefault();setProfileBusy(true);setProfileError('');
    try{
      const result=await act('/profile',form,'Profile details saved',undefined,'PATCH',true);
      if(result?.error){setProfileError(result.error);return;}
      if(photo!==undefined){const uploaded=await act('/profile/photo',{photo},'Profile photo saved',undefined,'PUT',true);if(uploaded?.error){setProfileError('Your details were saved, but the photo was not: '+uploaded.error);return;}}
      setEditing(false);setPhoto(undefined);setForm({});
    }finally{setProfileBusy(false);}
  }
  async function change(key,value){
    setBusy(true);setError('');
    try{
      const result=await act('/notifications/preferences',{bookingEmails:preferences.bookingEmails!==false,expiryEmails:preferences.expiryEmails!==false,[key]:value},'Email preferences saved',undefined,'PATCH',true);
      if(result?.error)setError(result.error);
    }finally{setBusy(false);}
  }
  return <><div className="page-heading"><div><h1>My profile</h1><p>Your member details and email preferences.</p></div></div>
    <div className="member-profile-grid"><Panel title="Member details" action={!editing&&<Button onClick={edit}>Edit profile</Button>}>
      {profileError&&<p className="form-error" role="alert">{profileError}</p>}
      <div className="profile-identity"><Avatar name={member.name} photo={editing&&photo!==undefined?photo:member.photo}/><div><h2>{member.name}</h2><p>Member at {state.settings.name}</p></div></div>
      {editing?<form onSubmit={save}><fieldset disabled={profileBusy} className="profile-edit-fields">
        <div className="profile-photo-actions"><label className="field"><span>Profile photo</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto}/></label>{(photo===undefined?member.photo:photo)&&<Button type="button" onClick={()=>setPhoto(null)}>Remove photo</Button>}</div><p className="quiet">JPEG, PNG, or WebP. Up to 2 MB. Photos are cropped to a square.</p>
        <Field label="Full name"><input required maxLength={120} autoComplete="name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></Field>
        <Field label="Email address"><input required type="email" maxLength={254} autoComplete="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></Field>
        <Field label="Phone number"><input type="tel" maxLength={40} autoComplete="tel" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></Field>
        {form.email.trim().toLowerCase()!==member.email&&<Field label="Current password to change your email"><input required type="password" maxLength={128} autoComplete="current-password" value={form.currentPassword} onChange={e=>setForm({...form,currentPassword:e.target.value})}/></Field>}
        <div className="form-actions"><Button type="button" onClick={()=>{setEditing(false);setPhoto(undefined);setForm({});setProfileError('');}}>Cancel</Button><Button variant="primary" type="submit">{profileBusy?'Saving?':'Save changes'}</Button></div>
      </fieldset></form>:<dl className="profile-fields"><div><dt>Email address</dt><dd>{member.email}</dd></div><div><dt>Phone number</dt><dd>{member.phone||'Not provided'}</dd></div><div><dt>Member since</dt><dd>{member.joinedAt?new Date(member.joinedAt).toLocaleDateString():'Not available'}</dd></div></dl>}
    </Panel>
    <Panel title="Email preferences"><p>Choose which activity updates you receive by email. All updates remain in your notification inbox.</p>{error&&<p className="form-error" role="alert">{error}</p>}<div className="notification-preferences" aria-busy={busy}>{[['bookingEmails','Booking updates','Confirmations and cancellations for your classes.'],['expiryEmails','Membership expiry reminders','Reminders before your membership expires.']].map(([key,label,description])=><label key={key}><input type="checkbox" checked={preferences[key]!==false} disabled={busy} onChange={e=>change(key,e.target.checked)}/><span><strong>{label}</strong><small>{description}</small></span></label>)}</div><p className="form-note">Account creation, membership confirmations, and payment receipts are always emailed when email delivery is available.</p></Panel></div>
  </>;
}
