import {useEffect,useRef} from 'react';
import {X,ArrowUpRight,Search} from 'lucide-react';
import {initials} from '../api';
export function Button({children,variant='',className='',...props}){return <button className={`button ${variant} ${className}`} {...props}>{children}</button>;}
export function Status({value}){return <span className={`status ${['expired','no-show','cancelled'].includes(value)?'danger':value==='pending'?'pending':''}`}><span/>{value}</span>;}
export function Avatar({name}){return <span className="avatar" aria-hidden="true">{initials(name||'?')}</span>;}
export function Empty({children='Nothing here yet.'}){return <div className="empty">{children}</div>;}
export function Panel({title,action,children,className=''}){return <section className={`panel ${className}`}>{title&&<div className="panel-heading"><h2>{title}</h2>{action}</div>}{children}</section>;}
export function Field({label,children}){return <label className="field"><span>{label}</span>{children}</label>;}
export function SearchBox({value,onChange,placeholder='Search members…'}){return <div className="search"><Search size={17}/><input aria-label={placeholder} placeholder={placeholder} value={value} onChange={e=>onChange(e.target.value)}/></div>;}
export function LinkButton({children,onClick}){return <button className="text-button" onClick={onClick}>{children}<ArrowUpRight size={15}/></button>;}
export function Modal({title,children,onClose}){
  const ref=useRef();useEffect(()=>{const d=ref.current;d.showModal();return()=>d.close();},[]);
  return <dialog ref={ref} onCancel={onClose} onClick={e=>{if(e.target===ref.current)onClose();}} aria-labelledby="modal-title"><div className="modal-head"><h2 id="modal-title">{title}</h2><button aria-label="Close dialog" className="icon-button" onClick={onClose}><X size={20}/></button></div>{children}</dialog>;
}
