// @ts-nocheck
import {useEffect,useRef,useState,useCallback} from 'react';
import {motion,AnimatePresence} from 'framer-motion';
import {Upload,Lock,Globe,Download,Eye,Trash2,File as FileIcon,X,FolderPlus,Pencil,RotateCcw} from 'lucide-react';

const api=async(url,opt={})=>{const r=await fetch('/api'+url,{credentials:'include',...opt,headers:{'Content-Type':'application/json',...(opt.headers||{})}});
  const j=await r.json().catch(()=>({success:false,error:{message:'Server unavailable'}}));if(!j.success)throw new Error(j.error?.message||'Error');return j.data};
const fmt=b=>b<1024?b+' B':b<1048576?(b/1024).toFixed(1)+' KB':b<1073741824?(b/1048576).toFixed(1)+' MB':(b/1073741824).toFixed(2)+' GB';
const ago=t=>{const s=(Date.now()-t)/1000;return s<60?'just now':s<3600?Math.floor(s/60)+' min ago':s<86400?Math.floor(s/3600)+' h ago':new Date(t).toLocaleDateString()};
const tokens=()=>JSON.parse(localStorage.getItem('vx_tokens')||'{}');

function Toast({msg}){return <AnimatePresence>{msg&&<motion.div className="toast" initial={{y:20,opacity:0}} animate={{y:0,opacity:1}} exit={{opacity:0}}>{msg}</motion.div>}</AnimatePresence>}

// real XHR upload with progress, speed, cancel
function uploadFiles(url,files,onProg,headers={}){const x=new XMLHttpRequest();
  const p=new Promise((res,rej)=>{const fd=new FormData();files.forEach(f=>fd.append('files',f));const t0=Date.now();
    x.open('POST','/api'+url);x.withCredentials=true;
    x.upload.onprogress=e=>onProg({pct:e.loaded/e.total*100,loaded:e.loaded,total:e.total,speed:e.loaded/((Date.now()-t0)/1000||1)});
    x.onload=()=>{try{const j=JSON.parse(x.responseText);j.success?res(j.data):rej(new Error(j.error.message))}catch{rej(new Error('Upload failed'))}};
    x.onerror=()=>rej(new Error('Upload failed'));x.onabort=()=>rej(new Error('Cancelled'));x.send(fd)});
  return {p,cancel:()=>x.abort()}}

function UploadZone({url,onDone,toast,onToken}){
  const [over,setOver]=useState(false),[job,setJob]=useState(null),inp=useRef();
  const start=async files=>{files=[...files];if(!files.length)return;
    const run=()=>{const u=uploadFiles(url,files,pr=>setJob(j=>({...j,...pr,state:'up'})));setJob({files,state:'up',pct:0,cancel:u.cancel,retry:run});
      u.p.then(d=>{setJob({files,state:'ok'});onToken?.(d);toast('✓ Upload complete');onDone();setTimeout(()=>setJob(null),2200)}).catch(e=>{setJob({files,state:'err',msg:e.message,retry:run});toast('✕ '+e.message)})};run()};
  return <div>
    <div className={'drop'+(over?' over':'')} onDragOver={e=>{e.preventDefault();setOver(true)}} onDragLeave={()=>setOver(false)}
      onDrop={e=>{e.preventDefault();setOver(false);start(e.dataTransfer.files)}}>
      <Upload size={30}/><h2 style={{letterSpacing:'.2em'}}>{over?'RELEASE TO UPLOAD':'DROP FILES HERE'}</h2>
      <p className="muted">or</p><button className="btn" onClick={()=>inp.current.click()}>SELECT FILES</button>
      <input ref={inp} type="file" multiple hidden onChange={e=>{start(e.target.files);e.target.value=''}}/></div>
    <AnimatePresence>{job&&<motion.div className="card" initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} exit={{opacity:0}}>
      <b>{job.state==='ok'?'✓ UPLOAD COMPLETE':job.state==='err'?'UPLOAD FAILED':`UPLOADING ${job.files.length} FILE(S)`}</b>
      <div className="small">{job.files.map(f=>f.name+' · '+fmt(f.size)).join(', ')}</div>
      <div className="bar"><i style={{width:(job.state==='ok'?100:job.pct||0)+'%'}}/></div>
      {job.state==='up'&&<div className="small">{Math.round(job.pct||0)}% · {fmt(job.speed||0)}/s · {job.speed?Math.ceil((job.total-job.loaded)/job.speed)+'s left':''} <button className="link" onClick={job.cancel}>CANCEL</button></div>}
      {job.state==='err'&&<div className="small">{job.msg} <button className="link" onClick={job.retry}>RETRY</button> <button className="link" onClick={()=>setJob(null)}>REMOVE</button></div>}
    </motion.div>}</AnimatePresence></div>}

function Preview({f,base,onClose}){
  const [ld,setLd]=useState(true),u=`/api${base}/${f.id}`;
  const k=/^image\/(png|jpe?g|webp|gif)/.test(f.mime)?'img':/^video/.test(f.mime)?'vid':/^audio/.test(f.mime)?'aud':f.mime==='application/pdf'?'pdf':f.mime==='text/plain'?'txt':null;
  return <div className="modal" role="dialog" aria-modal="true" aria-label={f.name}>
    <div className="top"><b style={{flex:1}}>{f.name}</b><a className="btn" href={u+'/download'}>DOWNLOAD</a><button className="btn ghost" onClick={onClose} aria-label="Close"><X size={14}/></button></div>
    <div className="body">{ld&&k&&<div className="sk" style={{width:300}}/>}
      {k==='img'&&<img src={u} onLoad={()=>setLd(false)} style={{display:ld?'none':'block'}}/>}
      {k==='vid'&&<video src={u} controls onLoadedData={()=>setLd(false)}/>}
      {k==='aud'&&<audio src={u} controls onLoadedData={()=>setLd(false)}/>}
      {(k==='pdf'||k==='txt')&&<iframe src={u} sandbox="" onLoad={()=>setLd(false)}/>}
      {!k&&<div style={{textAlign:'center'}}><h2>PREVIEW UNAVAILABLE</h2><p className="muted">This file format cannot be previewed here.</p><a className="btn" href={u+'/download'}>DOWNLOAD FILE</a></div>}</div>
    <div className="top small">{f.ext.toUpperCase()||'FILE'} · {fmt(f.size)} · Uploaded {new Date(f.uploadedAt).toLocaleDateString()}</div></div>}

function Files({items,loading,base,onPrev,actions}){
  if(loading)return <div className="files">{[...Array(8)].map((_,i)=><div key={i} className="sk"/>)}</div>;
  return <div className="files">{items.map(f=><motion.div layout key={f.id} className="fc" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}}>
    <div className="thumb">{/^image\/(png|jpe?g|webp|gif)/.test(f.mime)?<img loading="lazy" src={`/api${base}/${f.id}`}/>:<FileIcon size={34}/>}</div>
    <div className="in"><div className="n" title={f.name}>{f.name}</div><div className="small">{f.ext.toUpperCase()||'FILE'} • {fmt(f.size)} • {ago(f.uploadedAt)}</div>
      <div className="row" style={{marginTop:8}}><button className="link" onClick={()=>onPrev(f)}><Eye size={14}/> VIEW</button><a className="link" href={`/api${base}/${f.id}/download`}><Download size={14}/> GET</a>{actions?.(f)}</div></div></motion.div>)}
    {!items.length&&<p className="muted">Nothing here yet.</p>}</div>}

function Public({toast,admin}){
  const [items,setItems]=useState([]),[total,setT]=useState(0),[q,setQ]=useState(''),[sort,setSort]=useState('new'),[ld,setLd]=useState(true),[pv,setPv]=useState(null),[st,setSt]=useState(null);
  const load=useCallback(()=>{setLd(true);api(`/public/files?q=${encodeURIComponent(q)}&sort=${sort}`).then(d=>{setItems(d.items);setT(d.total)}).catch(e=>toast('✕ '+e.message)).finally(()=>setLd(false));api('/public/storage').then(setSt).catch(()=>{})},[q,sort]);
  useEffect(()=>{const t=setTimeout(load,250);return()=>clearTimeout(t)},[load]);
  const del=async f=>{try{await api('/public/files/'+f.id,{method:'DELETE',headers:{'x-owner-token':tokens()[f.id]||''}});toast('✓ File deleted');load()}catch(e){toast('✕ '+e.message)}};
  return <div className="wrap"><h1 style={{letterSpacing:'.2em'}}>PUBLIC VAULT</h1><p className="muted">Shared files accessible from anywhere.{st&&` ${st.files} files · ${fmt(st.bytes)} stored`}</p>
    <UploadZone url="/public/files/upload" toast={toast} onDone={load} onToken={d=>{const t=tokens();d.files.forEach(f=>t[f.id]=d.ownerToken);localStorage.setItem('vx_tokens',JSON.stringify(t))}}/>
    <h3 style={{letterSpacing:'.2em'}}>PUBLIC FILES ({total})</h3>
    <div className="row"><input placeholder="Search files..." aria-label="Search" value={q} onChange={e=>setQ(e.target.value)}/><select aria-label="Sort" value={sort} onChange={e=>setSort(e.target.value)}><option value="new">Newest</option><option value="name">Name</option><option value="size">Size</option></select></div>
    {!ld&&!items.length&&!q?<div className="card" style={{marginTop:20,textAlign:'center'}}><h3>THE PUBLIC VAULT IS EMPTY</h3><p className="muted">Be the first to upload a file.</p></div>:
    <Files items={items} loading={ld} base="/public/files" onPrev={setPv} actions={f=>(admin||tokens()[f.id])&&<button className="link" onClick={()=>del(f)}><Trash2 size={14}/></button>}/>}
    {pv&&<Preview f={pv} base="/public/files" onClose={()=>setPv(null)}/>}</div>}

function Login({onIn,toast}){
  const [e,setE]=useState(''),[p,setP]=useState(''),[b,setB]=useState(false),[err,setErr]=useState('');
  const go=async ev=>{ev.preventDefault();setB(true);setErr('');try{await api('/auth/login',{method:'POST',body:JSON.stringify({email:e,password:p})});onIn()}catch(x){setErr(x.message)}setB(false)};
  return <div className="wrap" style={{maxWidth:420}}><h1 style={{letterSpacing:'.2em'}}>PRIVATE VAULT</h1><p className="muted">ADMIN ACCESS ONLY</p>
    <form className="card" onSubmit={go} style={{display:'grid',gap:12}}><label>Email<input className="inp" style={{width:'100%'}} type="email" value={e} onChange={x=>setE(x.target.value)} autoComplete="username"/></label>
    <label>Password<input className="inp" style={{width:'100%'}} type="password" value={p} onChange={x=>setP(x.target.value)} autoComplete="current-password"/></label>
    {err&&<div role="alert"><b>ACCESS DENIED</b><div className="small">{err}</div></div>}<button className="btn" disabled={b}>{b?'SIGNING IN...':'SIGN IN'}</button></form></div>}

function Private({toast}){
  const [items,setItems]=useState([]),[folders,setFolders]=useState([]),[fid,setFid]=useState(null),[q,setQ]=useState(''),[trash,setTrash]=useState(false),[ld,setLd]=useState(true),[pv,setPv]=useState(null),[st,setSt]=useState(null),[act,setAct]=useState([]);
  const load=useCallback(()=>{setLd(true);Promise.all([api(`/private/files?q=${encodeURIComponent(q)}&trash=${trash?1:0}${fid?'&folder='+fid:''}`),api('/private/folders'),api('/private/storage'),api('/private/activity')])
    .then(([f,fo,s,a])=>{setItems(f.items);setFolders(fo);setSt(s);setAct(a)}).catch(e=>toast('✕ '+e.message)).finally(()=>setLd(false))},[q,trash,fid]);
  useEffect(()=>{const t=setTimeout(load,250);return()=>clearTimeout(t)},[load]);
  const act_=async(fn,m)=>{try{await fn();toast('✓ '+m);load()}catch(e){toast('✕ '+e.message)}};
  const cur=folders.find(f=>f.id===fid);
  return <div className="wrap"><h1 style={{letterSpacing:'.2em'}}>PRIVATE VAULT</h1><p className="muted">Your important files are protected.</p>
    {st&&<div className="stats"><div className="card"><b>{st.files}</b><span className="small">PRIVATE FILES</span></div><div className="card"><b>{fmt(st.bytes)}</b><span className="small">STORAGE USED</span></div><div className="card"><b>{st.folders}</b><span className="small">PRIVATE FOLDERS</span></div></div>}
    {st&&<p className="small">{Object.entries(st.breakdown).map(([k,v])=>`${k}: ${fmt(v)}`).join(' · ')}</p>}
    <p className="small"><button className="link" onClick={()=>{setFid(null);setTrash(false)}}>PRIVATE VAULT</button>{cur&&' / '+cur.name.toUpperCase()}{trash&&' / TRASH'}</p>
    {!trash&&<UploadZone url={`/private/files/upload${fid?'?folder='+fid:''}`} toast={toast} onDone={load}/>}
    <div className="row"><input placeholder="Search private files..." aria-label="Search" value={q} onChange={e=>setQ(e.target.value)}/>
      <button className="btn ghost" onClick={()=>{const n=prompt('Folder name');n&&act_(()=>api('/private/folders',{method:'POST',body:JSON.stringify({name:n,parentId:null})}),'Folder created')}}><FolderPlus size={14}/> FOLDER</button>
      <button className="btn ghost" onClick={()=>setTrash(!trash)}>{trash?'FILES':'TRASH'}</button></div>
    {!trash&&<div className="row" style={{marginTop:10}}>{folders.map(f=><button key={f.id} className={'btn ghost'} onClick={()=>setFid(f.id)}>{f.name}</button>)}</div>}
    <Files items={items} loading={ld} base="/private/files" onPrev={setPv} actions={f=><>
      {trash?<button className="link" onClick={()=>act_(()=>api('/private/files/'+f.id,{method:'PATCH',body:JSON.stringify({restore:true})}),'Restored')}><RotateCcw size={14}/></button>:<>
      <button className="link" onClick={()=>{const n=prompt('Rename',f.name);n&&act_(()=>api('/private/files/'+f.id,{method:'PATCH',body:JSON.stringify({name:n})}),'File renamed')}}><Pencil size={14}/></button>
      <select aria-label="Move" className="link" value="" onChange={e=>act_(()=>api('/private/files/'+f.id,{method:'PATCH',body:JSON.stringify({folderId:e.target.value==='root'?null:e.target.value})}),'File moved')}><option value="">MOVE</option><option value="root">Root</option>{folders.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></>}
      <button className="link" onClick={()=>act_(()=>api('/private/files/'+f.id,{method:'DELETE'}),trash?'Permanently deleted':'File deleted')}><Trash2 size={14}/></button></>}/>
    <h3 style={{letterSpacing:'.2em',marginTop:40}}>ACTIVITY</h3>{act.slice(0,8).map((a,i)=><div key={i} className="small">{a.t} — {ago(a.at)}</div>)}
    {pv&&<Preview f={pv} base="/private/files" onClose={()=>setPv(null)}/>}</div>}

function Landing({go}){return <div className="wrap">
  <motion.h1 className="hero" initial={{opacity:0,y:30}} animate={{opacity:1,y:0}} transition={{delay:1.2,duration:.6}}>YOUR FILES.<br/><span className="muted">YOUR SPACE.</span></motion.h1>
  <p className="muted" style={{maxWidth:520}}>Upload, access and share files from anywhere with VAULTX.</p>
  <div className="row" style={{marginTop:24}}><button className="btn" onClick={()=>go('public')}>OPEN PUBLIC VAULT</button><button className="btn ghost" onClick={()=>go('admin')}>ADMIN LOGIN</button></div>
  <p className="small" style={{marginTop:14}}>Public files are accessible to everyone. Private files are protected inside the Admin Vault.</p>
  <div className="two" id="how"><div className="card"><Globe/><h3>PUBLIC VAULT</h3><p className="muted">Upload and access shared files from any device.</p><button className="btn" onClick={()=>go('public')}>OPEN PUBLIC VAULT</button></div>
  <div className="card" style={{background:'#0d0d10'}}><Lock/><h3>PRIVATE VAULT</h3><p className="muted">Secure storage for important administrator documents.</p><button className="btn ghost" onClick={()=>go('admin')}>ADMIN LOGIN</button></div></div></div>}

export default function App(){
  const [page,setPage]=useState('home'),[admin,setAdmin]=useState(false),[msg,setMsg]=useState(''),[intro,setIntro]=useState(!matchMedia('(prefers-reduced-motion: reduce)').matches);
  const toast=m=>{setMsg(m);setTimeout(()=>setMsg(''),2600)};
  useEffect(()=>{api('/auth/session').then(d=>setAdmin(d.admin)).catch(()=>{});setTimeout(()=>setIntro(false),1700)},[]);
  const go=p=>setPage(p==='admin'&&admin?'private':p);
  return <>
    <div className="grid-bg"/>
    <AnimatePresence>{intro&&<motion.div className="intro" exit={{opacity:0}} transition={{duration:.4}}>
      <svg width="120" height="120" viewBox="0 0 100 100" fill="none" stroke="#c9ced8" strokeWidth="2"><motion.rect x="15" y="15" width="70" height="70" rx="8" initial={{pathLength:0}} animate={{pathLength:1}} transition={{duration:.8}}/><motion.circle cx="50" cy="50" r="16" initial={{pathLength:0}} animate={{pathLength:1}} transition={{delay:.4,duration:.7}}/><motion.path d="M50 34v32M34 50h32" initial={{pathLength:0}} animate={{pathLength:1}} transition={{delay:.8,duration:.4}}/></svg>
      <motion.b initial={{opacity:0,letterSpacing:'1em'}} animate={{opacity:1,letterSpacing:'.4em'}} transition={{delay:.7,duration:.7}} style={{position:'absolute',marginTop:170,fontSize:22}}>VAULTX</motion.b></motion.div>}</AnimatePresence>
    <nav><span className="logo" onClick={()=>setPage('home')}>VAULTX</span>
      <button className={'link'+(page==='public'?' on':'')} onClick={()=>setPage('public')}>PUBLIC VAULT</button>
      {admin?<><button className={'link'+(page==='private'?' on':'')} onClick={()=>setPage('private')}>PRIVATE VAULT</button>
        <button className="link" onClick={async()=>{await api('/auth/logout',{method:'POST'});setAdmin(false);setPage('home');toast('Signed out')}}>LOGOUT</button></>
      :<><button className="link" onClick={()=>{setPage('home');setTimeout(()=>document.getElementById('how')?.scrollIntoView({behavior:'smooth'}),50)}}>HOW IT WORKS</button><button className="link" onClick={()=>setPage('admin')}>ADMIN LOGIN</button></>}</nav>
    <AnimatePresence mode="wait"><motion.div key={page} initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:.15}}>
      {page==='home'&&<Landing go={go}/>}{page==='public'&&<Public toast={toast} admin={admin}/>}
      {page==='admin'&&!admin&&<Login toast={toast} onIn={()=>{setAdmin(true);setPage('private')}}/>}
      {(page==='private'||(page==='admin'&&admin))&&(admin?<Private toast={toast}/>:null)}</motion.div></AnimatePresence>
    <footer><b style={{letterSpacing:'.3em'}}>VAULTX</b><p>STORE. SHARE. ACCESS.</p><p className="small">A modern public and private file-storage platform.</p>
      <p>BUILT BY <span className="px">PYTHOSX</span></p><p className="small">© 2026 VAULTX</p></footer>
    <Toast msg={msg}/></>}
