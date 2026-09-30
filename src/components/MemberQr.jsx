import {useEffect,useState} from 'react';
import QRCode from 'qrcode';
import {api} from '../api';
import {Modal,Button} from './ui';
export default function MemberQr({state,close}){
  const [data,setData]=useState(null),[image,setImage]=useState(''),[error,setError]=useState(''),[tick,setTick]=useState(Date.now()),[retry,setRetry]=useState(0);
  useEffect(()=>{let current=true,running=false;async function load(){if(running)return;running=true;try{const response=await api('/attendance/qr');const receivedAt=Date.now();const image=response.token?await QRCode.toDataURL(response.token,{width:256,margin:4,errorCorrectionLevel:'M'}):'';if(current){setData({...response,offset:new Date(response.serverTime).getTime()-receivedAt});setImage(image);setError('');}}catch(e){if(current){setError(e.message);setImage('');}}finally{running=false;}}load();const timer=setInterval(load,15000);return()=>{current=false;clearInterval(timer);};},[retry]);
  useEffect(()=>{const timer=setInterval(()=>setTick(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const now=new Date(tick+(data?.offset||0)),expired=data&&now>=new Date(data.expiresAt);
  return <Modal title="My QR code" onClose={close}><div className="member-qr"><h3>{state.user.name}</h3><time dateTime={now.toISOString()} className="qr-clock">{now.toLocaleTimeString(undefined,{timeZone:data?.timeZone||state.settings.timezone,hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time><p className="quiet">{now.toLocaleDateString(undefined,{timeZone:data?.timeZone||state.settings.timezone,dateStyle:'long'})} · {data?.timeZone||state.settings.timezone}</p>
    {error?<p className="form-error" role="alert">{error}</p>:!data?<p>Preparing your QR code…</p>:data.checkedInToday?<p className="qr-success" role="status">You’re checked in for today.</p>:!data.eligible?<p className="form-error">An active membership with gym access is required.</p>:expired?<p role="status">Your code expired. Refresh to get a new one.</p>:image&&<><img className="qr-image" src={image} alt="Your temporary gym check-in QR code"/><p>Show this code to reception to check in.</p><small className="quiet">Refreshes automatically · valid for {Math.min(90,Math.max(0,Math.ceil((new Date(data.expiresAt)-now)/1000)))} seconds</small></>}
    {data&&<div className="qr-attendance"><strong>{data.monthlyAttendance}</strong><span>Gym visits this month</span></div>}<Button onClick={()=>setRetry(v=>v+1)}>Refresh</Button>
  </div></Modal>;
}
