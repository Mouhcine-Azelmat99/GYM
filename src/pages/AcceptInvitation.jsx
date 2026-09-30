import {useState} from 'react';
import {api} from '../api';
import {Button,Field,Panel} from '../components/ui';
export default function AcceptInvitation({token,onAccepted}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(event){event.preventDefault();const values=new FormData(event.currentTarget);if(values.get('password')!==values.get('confirm')){setError('Passwords must match.');return;}setBusy(true);setError('');try{await api('/auth/invitation',{token,password:values.get('password')});await onAccepted();}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <main className="invitation-accept"><Panel title="Welcome to your member portal"><p>Set your password to access your existing memberships and bookings.</p>{error&&<p role="alert" className="form-error">{error}</p>}<form onSubmit={submit}><Field label="New password"><input name="password" required type="password" minLength={10} maxLength={128} autoComplete="new-password"/></Field><Field label="Confirm password"><input name="confirm" required type="password" minLength={10} maxLength={128} autoComplete="new-password"/></Field><Button variant="primary" disabled={busy}>{busy?'Creating access…':'Set password and sign in'}</Button></form><p className="quiet">Expired or revoked link? Ask reception for a new invitation.</p><a href="#overview">Back to sign in</a></Panel></main>;
}
