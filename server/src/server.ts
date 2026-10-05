// @ts-nocheck
import 'dotenv/config';
import express from 'express'; import multer from 'multer'; import cookieParser from 'cookie-parser';
import helmet from 'helmet'; import cors from 'cors'; import pg from 'pg';
import {S3Client,DeleteObjectCommand,GetObjectCommand} from '@aws-sdk/client-s3'; import {Upload} from '@aws-sdk/lib-storage';
import crypto from 'crypto'; import fs from 'fs'; import os from 'os'; import path from 'path';
const E=process.env, PORT=+E.PORT||4000, SECRET=E.SESSION_SECRET||'dev-only-secret', PROD=E.NODE_ENV==='production';
if(PROD&&!E.SESSION_SECRET)throw new Error('SESSION_SECRET required');
const PUB_MAX=+E.PUBLIC_MAX_FILE_SIZE||104857600, PRIV_MAX=+E.PRIVATE_MAX_FILE_SIZE||104857600, PUB_LIMIT=+E.PUBLIC_STORAGE_LIMIT||8*2**30, RATE=+E.UPLOAD_RATE_LIMIT||30;
// ---- Postgres ----
pg.types.setTypeParser(20,Number);
const pool=new pg.Pool({connectionString:E.DATABASE_URL,ssl:E.DATABASE_URL&&!/localhost|127\.0\.0\.1/.test(E.DATABASE_URL)?{rejectUnauthorized:false}:undefined,max:5});
const q=(s,a=[])=>pool.query(s,a).then(r=>r.rows);
await q(`create table if not exists files(id text primary key,name text not null,ext text,mime text,size bigint,key text not null,vault_type text not null,folder_id text,uploaded_at bigint,deleted_at bigint,owner_hash text);
create index if not exists files_vault on files(vault_type,deleted_at);
create table if not exists folders(id text primary key,name text not null,parent_id text);
create table if not exists activity(id serial primary key,t text,at bigint);`);
const COLS=`id,name,ext,mime,size,key,vault_type "vaultType",folder_id "folderId",uploaded_at "uploadedAt",deleted_at "deletedAt",owner_hash "ownerHash"`;
const log=t=>q('insert into activity(t,at) values($1,$2)',[t,Date.now()]);
// ---- Storage abstraction: two isolated private buckets (S3 / Cloudflare R2 / Backblaze B2) ----
const s3=new S3Client({region:E.STORAGE_REGION||'auto',endpoint:E.STORAGE_ENDPOINT,forcePathStyle:true,credentials:{accessKeyId:E.STORAGE_ACCESS_KEY||'',secretAccessKey:E.STORAGE_SECRET_KEY||''}});
const B={PUBLIC:E.STORAGE_BUCKET_PUBLIC,PRIVATE:E.STORAGE_BUCKET_PRIVATE};
const Storage={
  put:async(v,key,file)=>{try{await new Upload({client:s3,params:{Bucket:B[v],Key:key,Body:fs.createReadStream(file),ContentType:'application/octet-stream'}}).done()}finally{fs.promises.rm(file,{force:true})}},
  delete:(v,key)=>s3.send(new DeleteObjectCommand({Bucket:B[v],Key:key})).catch(()=>{}),
  get:async(v,key)=>(await s3.send(new GetObjectCommand({Bucket:B[v],Key:key}))).Body,
};
const ok=(res,data)=>res.json({success:true,data}), fail=(res,s,code,message)=>res.status(s).json({success:false,error:{code,message}});
const h=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const safeName=n=>path.basename(String(n)).replace(/[^\w.\- ()]/g,'_').slice(0,200)||'file';
const pub=f=>({id:f.id,name:f.name,ext:f.ext,mime:f.mime,size:f.size,uploadedAt:f.uploadedAt});
const priv=f=>({...pub(f),folderId:f.folderId,deletedAt:f.deletedAt});
async function uniqueName(v,name,fid){let n=name,i=1;const {name:b,ext}=path.parse(name);
  while((await q('select 1 from files where vault_type=$1 and name=$2 and folder_id is not distinct from $3 and deleted_at is null',[v,n,fid])).length)n=`${b} (${i++})${ext}`;return n}
// ---- App ----
const app=express(); app.set('trust proxy',1);
app.use(helmet({crossOriginResourcePolicy:{policy:'same-site'},contentSecurityPolicy:{directives:{defaultSrc:["'self'"],imgSrc:["'self'","data:"],styleSrc:["'self'","'unsafe-inline'"],mediaSrc:["'self'"],frameSrc:["'self'"],objectSrc:["'none'"]}}}));
app.use(cors({origin:E.CLIENT_ORIGIN||false,credentials:true}));
app.use(cookieParser()); app.use(express.json({limit:'100kb'}));
const hits=new Map();
const limit=(max,win=60000)=>(req,res,next)=>{const k=req.ip+req.path,now=Date.now();
  const a=(hits.get(k)||[]).filter(t=>now-t<win);if(a.length>=max)return fail(res,429,'RATE_LIMITED','Too many requests.');a.push(now);hits.set(k,a);next()};
const sign=v=>crypto.createHmac('sha256',SECRET).update(v).digest('hex');
const isAdmin=req=>{const c=req.cookies.vx;if(!c)return false;const [exp,sig]=c.split('.');
  return !!sig&&sig.length===64&&+exp>Date.now()&&crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(sign(exp)))};
const needAdmin=(req,res,next)=>isAdmin(req)?next():fail(res,401,'UNAUTHORIZED','Authentication required.');
function checkPw(pw){const [s,hh]=(E.ADMIN_PASSWORD_HASH||':').split(':');if(!s||!hh)return false;
  const x=crypto.scryptSync(String(pw),s,64),y=Buffer.from(hh,'hex');return x.length===y.length&&crypto.timingSafeEqual(x,y)}
app.post('/api/auth/login',limit(8),h(async(req,res)=>{const {email,password}=req.body||{};
  if(email&&email===E.ADMIN_EMAIL&&checkPw(password)){const exp=String(Date.now()+12*3600e3);
    res.cookie('vx',`${exp}.${sign(exp)}`,{httpOnly:true,sameSite:'strict',secure:PROD,maxAge:12*3600e3});await log('Admin signed in');return ok(res,{admin:true})}
  fail(res,401,'ACCESS_DENIED','Invalid credentials.')}));
app.post('/api/auth/logout',(req,res)=>{res.clearCookie('vx');ok(res,{})});
app.get('/api/auth/session',(req,res)=>ok(res,{admin:isAdmin(req)}));
app.get('/api/health',h(async(req,res)=>{await q('select 1');ok(res,{status:'ok'})}));
const uploader=max=>multer({dest:os.tmpdir(),limits:{fileSize:max,files:10}}).array('files');
const sendFile=async(res,f,v,inline)=>{const safeInline=inline&&/^(image\/(png|jpe?g|webp|gif)|video\/|audio\/|application\/pdf|text\/plain)/.test(f.mime);
  res.setHeader('Content-Type',safeInline?f.mime:'application/octet-stream');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'; media-src 'self'; img-src 'self'");
  res.setHeader('Content-Disposition',`${safeInline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  res.setHeader('Cache-Control',v==='PRIVATE'?'private, no-store':'public, max-age=300');
  (await Storage.get(v,f.key)).on('error',()=>res.end()).pipe(res)};
const store=(v,max,fid,tokenHash)=>(req,res,after)=>uploader(max)(req,res,async err=>{
  try{if(err)return fail(res,400,'UPLOAD_FAILED',err.code==='LIMIT_FILE_SIZE'?'File too large.':'Upload failed.');
    const out=[];for(const f of req.files||[]){const name=await uniqueName(v,safeName(f.originalname),fid(req)),key=crypto.randomUUID();
      await Storage.put(v,key,f.path);const r={id:crypto.randomUUID(),name,ext:path.extname(name).slice(1).toLowerCase(),mime:f.mimetype||'application/octet-stream',size:f.size,uploadedAt:Date.now()};
      await q('insert into files(id,name,ext,mime,size,key,vault_type,folder_id,uploaded_at,owner_hash) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[r.id,r.name,r.ext,r.mime,r.size,key,v,fid(req),r.uploadedAt,tokenHash?.(req)||null]);
      if(v==='PRIVATE')await log(`Uploaded ${name}`);out.push(r)}after(req,res,out)}catch(e){(req.files||[]).forEach(f=>fs.rm(f.path,{force:true},()=>{}));fail(res,500,'UPLOAD_FAILED','Upload failed.')}});
// ---- PUBLIC (queries are hard-coded to vault_type='PUBLIC') ----
const PUBW="vault_type='PUBLIC' and deleted_at is null";
app.get('/api/public/files',h(async(req,res)=>{const s=String(req.query.q||'').replace(/[%_\\]/g,'\\$&'),page=Math.max(1,+req.query.page||1);
  const ord={name:'name asc',size:'size desc'}[req.query.sort]||'uploaded_at desc';
  const w=`${PUBW} and ($1='' or name ilike '%'||$1||'%' or ext ilike $1 or mime ilike '%'||$1||'%')`;
  const items=await q(`select ${COLS} from files where ${w} order by ${ord} limit 60 offset $2`,[s,(page-1)*60]);
  const [{c}]=await q(`select count(*)::int c from files where ${w}`,[s]);ok(res,{total:c,items:items.map(pub)})}));
app.get('/api/public/storage',h(async(req,res)=>{const [r]=await q(`select count(*)::int files,coalesce(sum(size),0) bytes from files where ${PUBW}`);ok(res,{...r,limit:PUB_LIMIT})}));
app.post('/api/public/files/upload',limit(RATE),h(async(req,res,next)=>{
  const [{b}]=await q(`select coalesce(sum(size),0) b from files where ${PUBW}`);if(b>=PUB_LIMIT)return fail(res,507,'QUOTA','Public vault is full.');next()}),
  (req,res)=>{const token=crypto.randomBytes(24).toString('hex');
    store('PUBLIC',PUB_MAX,()=>null,()=>sha(token))(req,res,(rq,rs,files)=>ok(rs,{files,ownerToken:token}))});
const getPub=async id=>(await q(`select ${COLS} from files where id=$1 and ${PUBW}`,[id]))[0];
app.get('/api/public/files/:id',h(async(req,res)=>{const f=await getPub(req.params.id);f?sendFile(res,f,'PUBLIC',true):fail(res,404,'FILE_NOT_FOUND','The requested file could not be found.')}));
app.get('/api/public/files/:id/download',h(async(req,res)=>{const f=await getPub(req.params.id);f?sendFile(res,f,'PUBLIC',false):fail(res,404,'FILE_NOT_FOUND','The requested file could not be found.')}));
app.delete('/api/public/files/:id',h(async(req,res)=>{const f=await getPub(req.params.id);if(!f)return fail(res,404,'FILE_NOT_FOUND','Not found.');
  const tok=req.get('x-owner-token');if(!isAdmin(req)&&!(tok&&sha(tok)===f.ownerHash))return fail(res,403,'FORBIDDEN','You can only delete files you uploaded.');
  await Storage.delete('PUBLIC',f.key);await q('delete from files where id=$1',[f.id]);ok(res,{})}));
// ---- PRIVATE (admin only, vault_type='PRIVATE' only) ----
const R=express.Router();R.use(needAdmin);
const getV=async id=>(await q(`select ${COLS} from files where id=$1 and vault_type='PRIVATE'`,[id]))[0];
const F=async(req,res)=>{const f=await getV(req.params.id);if(!f)fail(res,404,'FILE_NOT_FOUND','The requested file could not be found.');return f};
R.get('/files',h(async(req,res)=>{const s=String(req.query.q||'').replace(/[%_\\]/g,'\\$&'),trash=req.query.trash==='1',fid=req.query.folder||null;
  const items=await q(`select ${COLS} from files where vault_type='PRIVATE' and (deleted_at is not null)=$1 and ($1 or folder_id is not distinct from $2) and ($3='' or name ilike '%'||$3||'%') order by uploaded_at desc limit 500`,[trash,fid,s]);ok(res,{items:items.map(priv)})}));
R.post('/files/upload',limit(RATE),(req,res)=>store('PRIVATE',PRIV_MAX,r=>r.query.folder||null)(req,res,(rq,rs,files)=>ok(rs,{files})));
R.get('/files/:id',h(async(req,res)=>{const f=await F(req,res);f&&sendFile(res,f,'PRIVATE',true)}));
R.get('/files/:id/download',h(async(req,res)=>{const f=await F(req,res);if(f){await log(`Downloaded ${f.name}`);sendFile(res,f,'PRIVATE',false)}}));
R.patch('/files/:id',h(async(req,res)=>{const f=await F(req,res);if(!f)return;const b=req.body||{};
  if(b.name)f.name=safeName(b.name);if('folderId' in b)f.folderId=b.folderId;if(b.restore)f.deletedAt=null;
  await q('update files set name=$2,folder_id=$3,deleted_at=$4 where id=$1',[f.id,f.name,f.folderId,f.deletedAt]);await log(`Updated ${f.name}`);ok(res,priv(f))}));
R.delete('/files/:id',h(async(req,res)=>{const f=await F(req,res);if(!f)return;
  if(req.query.permanent==='1'||f.deletedAt){await Storage.delete('PRIVATE',f.key);await q('delete from files where id=$1',[f.id]);await log(`Permanently deleted ${f.name}`)}
  else{await q('update files set deleted_at=$2 where id=$1',[f.id,Date.now()]);await log(`Moved ${f.name} to trash`)}ok(res,{})}));
R.get('/folders',h(async(req,res)=>ok(res,(await q('select id,name,parent_id "parentId" from folders order by name')))));
R.post('/folders',h(async(req,res)=>{const r={id:crypto.randomUUID(),name:safeName(req.body?.name||''),parentId:req.body?.parentId||null};
  await q('insert into folders values($1,$2,$3)',[r.id,r.name,r.parentId]);await log(`Created folder "${r.name}"`);ok(res,r)}));
R.patch('/folders/:id',h(async(req,res)=>{await q('update folders set name=$2 where id=$1',[req.params.id,safeName(req.body?.name)]);ok(res,{})}));
R.delete('/folders/:id',h(async(req,res)=>{const [{c}]=await q(`select count(*)::int c from files where vault_type='PRIVATE' and folder_id=$1 and deleted_at is null`,[req.params.id]);
  if(c)return fail(res,409,'NOT_EMPTY','Folder is not empty.');await q('delete from folders where id=$1',[req.params.id]);ok(res,{})}));
R.get('/storage',h(async(req,res)=>{const l=await q(`select mime,size from files where vault_type='PRIVATE' and deleted_at is null`);const cat={Documents:0,Media:0,Images:0,Other:0};
  l.forEach(f=>{const k=/^image/.test(f.mime)?'Images':/^(video|audio)/.test(f.mime)?'Media':/pdf|text|word|sheet|presentation/.test(f.mime)?'Documents':'Other';cat[k]+=f.size});
  const [{c}]=await q('select count(*)::int c from folders');ok(res,{files:l.length,folders:c,bytes:l.reduce((s,f)=>s+f.size,0),breakdown:cat})}));
R.get('/activity',h(async(req,res)=>ok(res,await q('select t,at from activity order by id desc limit 50'))));
app.use('/api/private',R);
app.use('/api',(req,res)=>fail(res,404,'NOT_FOUND','Route not found.'));
// serve the built React app from the same service (one free deploy)
const DIST=path.resolve('../client/dist');
if(fs.existsSync(DIST)){app.use(express.static(DIST));app.get('*',(req,res)=>res.sendFile(path.join(DIST,'index.html')))}
app.use((e,req,res,n)=>{console.error(e.message);fail(res,500,'SERVER_ERROR','Something went wrong.')});
app.listen(PORT,()=>console.log(`VAULTX on :${PORT}`));
