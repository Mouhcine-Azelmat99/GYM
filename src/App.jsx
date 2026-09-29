import {useState,useEffect,useCallback,lazy,Suspense} from 'react';
import {CheckCircle2,X,AlertCircle} from 'lucide-react';
import {api} from './api';
import Shell from './components/Shell';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Dialogs from './components/Dialogs';
const module=()=>import('./pages/Management');
const pages=Object.fromEntries(['Members','Memberships','Schedule','Attendance','Team','Settings','MemberHome'].map(key=>[key,lazy(()=>module().then(m=>({default:m[key]})))]));
pages.Payments=lazy(()=>import('./pages/Payments'));
export default function App(){
  const [config,setConfig]=useState(null),[state,setState]=useState(null),[loading,setLoading]=useState(true),[fatal,setFatal]=useState(''),[page,setPage]=useState(location.hash.slice(1)||'overview'),[dialog,setDialog]=useState(null),[toast,setToast]=useState(null);
  const refresh=useCallback(async()=>{const next=await api('/state');setState(next);return next;},[]);
  async function initialize(){setLoading(true);setFatal('');try{const c=await api('/config');setConfig(c);try{await refresh();}catch(e){if(e.status!==401)throw e;}}catch(e){setFatal(e.message);}setLoading(false);}
  useEffect(()=>{initialize();const update=()=>{setPage(location.hash.slice(1)||'overview');setDialog(null);};window.addEventListener('hashchange',update);return()=>window.removeEventListener('hashchange',update);},[]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(null),5000);return()=>clearTimeout(timer);},[toast]);
  const navigate=p=>{location.hash=p;setPage(p);};const open=(type,data)=>setDialog({type,data});
  async function act(path,body,message,callback,method='POST',inline=false){try{const result=await api(path,body,method);await refresh();setToast({message});callback?.(result);return result;}catch(e){if(e.status===401)setState(null);if(!inline)setToast({message:e.message,error:true});return {error:e.message};}}
  async function logout(){try{await api('/auth/logout',{});setState(null);setDialog(null);navigate('overview');}catch(e){setToast({message:e.message,error:true});}}
  async function switchRole(){try{await api('/auth/demo',{role:state.user.role==='member'?'owner':'member'});await refresh();navigate('overview');}catch(e){setToast({message:e.message,error:true});}}
  if(loading)return <div className="loading-screen"><strong>FORMA.</strong><span>Opening your workspace…</span></div>;
  if(fatal)return <div className="loading-screen"><h1>Couldn’t connect to Forma.</h1><p>{fatal}</p><button className="button primary" onClick={initialize}>Try again</button></div>;
  if(!state)return <Login config={config} onLogin={async()=>{await refresh();navigate(new URLSearchParams(location.search).has('checkout')?'payments':'overview');}}/>;
  const allowed=state.user.role==='member'?['overview','memberships','schedule','payments']:state.user.role==='trainer'?['overview','schedule']:state.user.role==='receptionist'?['overview','members','memberships','schedule','attendance','payments']:['overview','members','memberships','schedule','attendance','payments','team','settings'];
  const safePage=allowed.includes(page)?page:'overview';
  const key=safePage==='overview'?(state.user.role==='member'?'MemberHome':state.user.role==='trainer'?'Schedule':null):safePage[0].toUpperCase()+safePage.slice(1);const Page=key?pages[key]:Dashboard;
  return <><Shell state={state} page={safePage} navigate={navigate} onLogout={logout} onSwitch={switchRole}><Suspense fallback={<div className="empty">Loading workspace…</div>}><Page state={state} navigate={navigate} open={open} act={act} refresh={refresh}/></Suspense></Shell>{dialog&&<Dialogs key={dialog.type+dialog.data?.id} dialog={dialog} state={state} close={()=>setDialog(null)} open={open} act={act}/>}<div className="toast-region" aria-live="polite">{toast&&<div className={'toast '+(toast.error?'toast-error':'')}>{toast.error?<AlertCircle size={18}/>:<CheckCircle2 size={18}/>}<span>{toast.message}</span><button className="icon-button" aria-label="Dismiss notification" onClick={()=>setToast(null)}><X size={16}/></button></div>}</div></>;
}
