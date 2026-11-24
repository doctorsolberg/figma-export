import {statfs,link,unlink,mkdir,lstat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {browserListing,defaultExportTimeoutMinutes} from './config.mjs';
import {folderKey,forgetFolder,recordFolder,reusableFolder,invalidateFiles} from './checkpoints.mjs';
import {findCard,recoverCard,relocateUniqueCard,scanInventory,waitForCards} from './inventory.mjs';
import {reportStore,Skip,Stop} from './report-store.mjs';
import {trustedChallengeUrl,autoStartChallenge} from './captcha-start.mjs';
export {reportStore} from './report-store.mjs';
export {card,cardIdentity,canonicalCards,waitForCards} from './inventory.mjs';
const archive=fileURLToPath(new URL('./archive.py',import.meta.url));
const extensions=new Set(['.fig','.deck','.jam','.make','.buzz','.site']);
const exact=(p,role,name)=>p.getByRole(role,{name,exact:true});
const texts=async p=>await p.locator('body').innerText({timeout:2500}).catch(()=> '');
const firstVisible=async loc=>{for(const l of await loc.all()) if(await l.isVisible()) return l;};


export function fileRef(url){
  try { const u=new URL(url); if(!['https://www.figma.com','https://figma.com'].includes(u.origin)||u.username||u.password) return null;
    const m=/^\/(design|board|slides|make|site|sites|buzz|proto|file|spec)\/([a-zA-Z0-9]+)(?:\/|$)/.exec(u.pathname);
    return m && {type:m[1],key:m[2],url:u.origin+u.pathname};
  } catch {return null;}
}

export function classify(url,markers={}){
  if(trustedChallengeUrl(url))return 'verification';
  try {
    const u=new URL(url);
    if(['https://www.figma.com','https://figma.com'].includes(u.origin)&&/^\/(?:login|signup)(?:\/|$)/i.test(u.pathname))return 'login';
  } catch {}
  if(markers.verification===true)return 'verification';
  return 'ready';
}
export function editorRef(url){const r=fileRef(url);return r?.type==='proto'?null:r;}
export function safeName(s){
  if(typeof s!=='string'||/[\/\\:\x00-\x1f]/.test(s)||s.startsWith('.')||!extensions.has(path.extname(s).toLowerCase())) throw new Error('Unexpected native archive filename: '+s);
  return s;
}

async function heading(p){
  return await firstVisible(p.getByRole('button',{name:'Main menu',exact:true}).or(p.getByRole('combobox',{name:'Main menu',exact:true})).or(p.locator('[aria-label="Main menu"]')));
}
async function waitReady(p,test,timeout=65000,check){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
    await check?.();
    const v=await test(); if(v)return v;
    if(p.isClosed())throw new Stop('The Figma window was closed');
    await sleep(500);
  }
  throw new Skip('The Figma page did not load in time');
}
function localKey(url){const u=new URL(url);return u.origin+u.pathname;}
function sameListing(a,b){
  const left=browserListing(a), right=browserListing(b);
  if(!left||!right)return false;
  // Figma normalizes the host and may use a project/folder alias for the same ID.
  return folderKey(a)?folderKey(a)===folderKey(b):left.pathname.replace(/\/$/,'')===right.pathname.replace(/\/$/,'');
}
async function cardControl(p,x){
  const [visible]=await waitForCards(async()=>{const found=await findCard(p,x.label,x.index,x.position,x.virtualIndex);return found?[found]:[];},{timeout:1500,interval:250});
  if(visible)return visible;
  const recovered=await recoverCard(p,x);
  if(recovered)return recovered;
  if(x.virtualIndex!=null&&/\/recently-viewed\/?$/.test(new URL(p.url()).pathname))return relocateUniqueCard(p,x);
  return null;
}

async function openCard(p,ctx,x,kind){
  const expected=kind==='file'&&fileRef(x.anchor);
  if(expected){
    if(expected.type==='proto')return {p,ref:expected};
    const editor=await ctx.newPage();
    try {await go(editor,x.anchor);return {p:editor,ref:expected};}
    catch(e){await editor.close().catch(()=>{});throw e;}
  }
  const clickTarget=await cardControl(p,x);
  if(!clickTarget)throw new Skip('The card is no longer present in the listing');
  const old=p.url(), pages=new Set(ctx.pages());
  const after=()=>ctx.pages().find(q=>!pages.has(q)&&fileRef(q.url()));
  if(kind==='folder') await clickTarget.press('Enter',{timeout:9000});
  else await clickTarget.dblclick({timeout:9000});
  return waitReady(p,async()=>{
    const q=after()??p;
    if(kind==='file'&&fileRef(q.url())) return {p:q,ref:fileRef(q.url())};
    if(kind==='folder'&&folderKey(p.url())&&!sameListing(p.url(),old)){
      const heading=await firstVisible(p.getByRole('heading',{name:x.title,exact:true}));
      if(heading)return {p};
    }
  },30000);
}
async function seenChallenge(p){
  const byUrl=classify(p.url());
  if(byUrl!=='ready'||!p.evaluate)return byUrl;
  const verification=await p.evaluate(()=>{
    const match=/Figma needs to verify you are not a bot|verify (?:that )?you are (?:human|not a (?:robot|bot))|checking your browser/i;
    return [...document.querySelectorAll('[role="dialog"],[role="alertdialog"],[role="alert"],h1,h2,[role="heading"]')]
      .some(e=>e.getClientRects().length && !e.closest('[aria-hidden="true"]') && match.test(e.innerText??''));
  }).catch(()=>false);
  return classify(p.url(),{verification});
}
async function go(p,u){
  try {await p.goto(u,{waitUntil:'domcontentloaded',timeout:60000});}
  catch(e){
    if(/net::ERR_(?:INTERNET_DISCONNECTED|NETWORK_CHANGED|NAME_NOT_RESOLVED|CONNECTION_.+|PROXY_.+|TIMED_OUT)\b/i.test(e.message))throw new Stop('Network unavailable; resume the export when the connection is restored',{cause:e});
    throw e;
  }
}
function commitArchive(args){
  return new Promise((resolve,reject)=>{
    const child=spawn('python3',[archive,...args],{stdio:['ignore','pipe','pipe',3],timeout:300_000});
    let stdout='',stderr='';
    child.stdout.setEncoding('utf8').on('data',data=>{stdout=(stdout+data).slice(-4096);});
    child.stderr.setEncoding('utf8').on('data',data=>{stderr=(stderr+data).slice(-4096);});
    child.once('error',reject);
    child.once('close',(code,signal)=>{
      if(code===0)resolve(stdout);
      else reject(Object.assign(Error(stderr.trim()||`Archiver exited: ${signal??code}`),{code}));
    });
  });
}
class InterruptedDownload extends Error {}

async function waitForTransfer(download,timeout){
  const timer=new AbortController();
  try {
    await Promise.race([
      download.path().catch(e=>{throw new InterruptedDownload('Chrome did not complete the download',{cause:e});}),
      sleep(timeout,undefined,{signal:timer.signal}).then(()=>{throw new InterruptedDownload('Chrome download timed out');}),
    ]);
  } finally {timer.abort();}
}

async function saveDownload(download,ref,title,parts,root){
  const fname=safeName(download.suggestedFilename());
  const ext=path.extname(fname).toLowerCase();
  const stage=path.join(root,`.playwright-${randomUUID()}${ext}`);
  await download.saveAs(stage);
  try {
    const stdout=await commitArchive([root,stage,ref.key,ref.url,title,ext,JSON.stringify(parts)]);
    console.log('OK '+stdout.trim());
  } catch(e){
    if(e.code!==3)throw new Stop('Archiver failed; completed download left in staging: '+e.message,{cause:e});
    const q=path.join(root,'_unverified'); await mkdir(q,{recursive:true});
    const info=await lstat(q);
    if(!info.isDirectory()||info.isSymbolicLink())throw new Stop('Unsafe quarantine directory; download left in staging');
    await link(stage,path.join(q,`${randomUUID()}-${fname}`)); await unlink(stage);
    throw new Skip('The downloaded archive failed validation and was kept separately: '+e.message);
  }
}
async function invokeExport(p,verifyTarget,arm){
  const check=async()=>{
    if(await seenChallenge(p)!=='ready')throw new InterruptedDownload('Figma requested sign-in or verification while opening the export menu');
    verifyTarget();
  };
  const main=await waitReady(p,()=>heading(p),85000,check);
  await main.click({timeout:8000});
  const f=await waitReady(p,()=>firstVisible(exact(p,'menuitem','File')),9000,check);
  await f.click({timeout:8000});
  const save=await waitReady(p,()=>firstVisible(p.getByRole('menuitem',{name:/^Save local copy/})),9000,check);
  if(!(await save.isEnabled()))throw new Skip('Figma does not allow saving a local copy');
  await check();
  arm();
  await save.click({timeout:8000});
}
async function waitUser(p,state,title,autoCaptcha,timeout=30*60_000){
  let notified='',triedStarter=false,lastNotice=0;
  const deadline=Date.now()+timeout;
  while(!p.isClosed()){
    const phase=await seenChallenge(p);
    if(phase==='ready')return;
    if(Date.now()>=deadline)throw new Stop('Timed out waiting for manual Figma verification or sign-in');
    if(phase!==notified||Date.now()-lastNotice>=60_000){
      notified=phase;lastNotice=Date.now();await state(phase,{file:title});
      console.log(phase==='verification'?'CAPTCHA: '+title+' — solve it in the dedicated Chrome window; the exporter will resume automatically.':'Sign in to Figma in the dedicated Chrome window. The exporter is waiting.');
    }
    if(autoCaptcha&&phase==='verification'&&!triedStarter){
      triedStarter=true;
      // Load at the checkpoint; only open the puzzle, never interact with its answers.
      const opened=await autoStartChallenge(p).catch(()=>false);
      if(opened){await state('captcha_ready',{file:title});console.log('CAPTCHA opened for '+title+'; waiting for manual solution.');}
    }
    await sleep(1600);
  }
  throw new Stop('The Figma window was closed');
}
export async function exportFile(p,ref,title,parts,state,{root,autoCaptcha,downloadTimeout=defaultExportTimeoutMinutes*60_000,transferTimeout=downloadTimeout}){
  const disk=await statfs(root); if(disk.bavail*disk.bsize<2*1024**3)throw new Stop('Less than 2 GiB of free disk space remains');
  let dl=null, armed=false, documentVersion=0;
  const listener=d=>{if(armed&&!dl&&/^(blob:)?https:\/\/(www\.)?figma\.com\//.test(d.url())) dl=d;};
  const documentLoaded=()=>{documentVersion++;};
  const verifyTarget=()=>{if(editorRef(p.url())?.key!==ref.key)throw new Skip('Figma redirected to a different file');};
  p.on('download',listener);
  p.on('domcontentloaded',documentLoaded);
  try {
    for(let attempt=0;attempt<3;attempt++){
      let started=documentVersion;
      try {
        await waitUser(p,state,title,autoCaptcha);
        if(fileRef(p.url())?.key!==ref.key)await go(p,ref.url);
        await waitUser(p,state,title,autoCaptcha);
        verifyTarget();
        started=documentVersion;
        await state('exporting',{file:title,project:parts,attempt:attempt+1});
        // The document can reload while a Playwright click or menu wait is still in flight.
        let menuInterrupted=false;
        try {
          await invokeExport(p,verifyTarget,()=>{armed=true;});
        } catch(e) {
          if(!dl){
            if(e instanceof Stop||p.isClosed())throw e;
            if(!(e instanceof InterruptedDownload)&&await seenChallenge(p)==='ready'&&!dl)throw e;
            menuInterrupted=true;
          }
        }
        let deadline=Date.now()+downloadTimeout;
        while(Date.now()<deadline&&!dl){
          if(p.isClosed())throw new Stop('The Figma window was closed');
          const challenge=await seenChallenge(p);
          if(menuInterrupted||challenge!=='ready'){
            await waitUser(p,state,title,autoCaptcha);
            if(!dl)verifyTarget();
            if(!armed)throw new InterruptedDownload('Figma interrupted the export menu before Save local copy');
            // Figma sometimes resumes the same export after manual verification.
            let resumed=false;
            for(let i=0;i<10&&!dl;i++){
              if(/Downloading images|Save partial file|Preparing (?:your )?(?:download|file)/i.test(await texts(p))){resumed=true;break;}
              await sleep(500);
            }
            if(!dl&&!resumed)throw new InterruptedDownload('Figma did not resume the export after verification');
            menuInterrupted=false;
            started=documentVersion;
            deadline=Date.now()+downloadTimeout;
            await state('exporting',{file:title,project:parts,attempt:attempt+1});
          } else if(documentVersion!==started){
            verifyTarget();
            if(!dl)throw new InterruptedDownload('The editor reloaded before the download started');
          } else if(editorRef(p.url())?.key!==ref.key){
            verifyTarget();
          }
          if(!dl)await sleep(800);
        }
        if(!dl)throw new Skip('Figma did not finish the export before the download deadline');
        await state('downloading',{file:title,project:parts,attempt:attempt+1});
        await waitForTransfer(dl,transferTimeout);
        return await saveDownload(dl,ref,title,parts,root);
      } catch(e){
        if(e instanceof Stop||p.isClosed())throw e;
        const reloaded=!dl&&documentVersion!==started&&editorRef(p.url())?.key===ref.key;
        if(!(e instanceof InterruptedDownload)&&!reloaded)throw e;
        armed=false;
        if(dl){
          const abandoned=dl;
          dl=null;
          const timer=new AbortController();
          try {
            await Promise.race([
              abandoned.cancel(),
              sleep(5000,undefined,{signal:timer.signal}).then(()=>{throw Error('Chrome did not acknowledge cancellation');}),
            ]);
          } catch(cause) {throw new Stop('Could not safely cancel the stalled Chrome download',{cause});}
          finally {timer.abort();}
        }
        if(attempt===2)throw new Skip('Export interrupted after three attempts: '+e.message,{cause:e});
        await state('retrying',{file:title,project:parts,attempt:attempt+2,reason:e.message.split('\n')[0]});
        // Clear a stale export/menu only when an external refresh did not already replace it.
        if(!reloaded){
          verifyTarget();
          await go(p,ref.url);
        }
      }
    }
  } finally {p.off('domcontentloaded',documentLoaded);p.off('download',listener);}
}
export async function run({page,ctx,state,config,exportNative=exportFile}){
  const {root,scopes,rescan,autoCaptcha}=config;
  const store=reportStore(root);
  const active=new Set(), results=new Map();
  let skippedFolders=0;
  const addIssue=async (parts,error,ref,title,details={})=>{
    const reason=String(error.message??error).split('\n')[0];
    const old=ref&&(await store.read()).files[ref.key];
    const stillSaved=old?.status==='saved'&&await store.exists(old.path,old.bytes);
    await store.update(d=>{
      d.issues.push({scope:parts.join('/'),reason,...details});
      if(ref&&!stillSaved)d.files[ref.key]={title,url:ref.url,status:'not_saved',reason};
    });
    console.error('Skipped '+parts.join('/')+': '+reason);
  };
  const walk=async (u,parts,depth=0)=>{
    if(depth>10)throw new Skip('Folder nesting exceeds the supported limit');
    if(!browserListing(u))throw new Skip('Not a Figma file-browser URL');
    const key=JSON.stringify([folderKey(u)??localKey(u),parts]);
    if(results.has(key))return results.get(key);
    if(active.has(folderKey(u)??localKey(u)))throw new Skip('Folder cycle');
    const existing=await reusableFolder(await store.read(),u,parts,store.exists,{rescan});
    if(existing){
      skippedFolders++;console.log('Checkpoint: '+parts.join('/'));
      results.set(key,existing);return existing;
    }
    // Remove a stale marker before visiting so an interruption cannot leave it complete.
    if(folderKey(u))await store.update(d=>forgetFolder(d,u));
    active.add(folderKey(u)??localKey(u));
    try{
      await state('scanning',{project:parts});
      if(rescan||!sameListing(page.url(),u))await go(page,u);
      await waitUser(page,state,parts.join('/'),autoCaptcha);
      if(!browserListing(page.url()))await go(page,u);
      if(!sameListing(page.url(),u))throw new Skip('Figma redirected to a different listing');
      const backUrl=page.url();
      await waitReady(page,async()=>await firstVisible(page.getByRole('button',{name:'Recents',exact:true}).or(page.getByText('All folders',{exact:true}))),55000);
      const {cards:rows,unknown,verified,expected,observed,coverageGap}=await scanInventory(page);
      console.log(parts.join('/')+': '+rows.length+' cards');
      for(const row of unknown)await addIssue(parts,Error('Unrecognized or unsupported listing entry: '+row.label),null,null,
        {code:'unresolved_listing_entry',listing:localKey(backUrl),evidence:row.evidence});
      if(!verified&&coverageGap!=='unresolved_entries')await addIssue(parts,Error(`Inventory completeness could not be verified (${observed} observed, ${expected ?? 'no reliable total'}; ${coverageGap}); no checkpoint was saved`),null,null,
        {code:'unverified_inventory',listing:localKey(backUrl),coverageGap,observed,expected});
      let complete=verified&&unknown.length===0;
      const keys=new Set();
      for(const [index,x] of rows.entries()){
        let q=page,ref,exportAttempted=false;
        try{
          const d=await store.read();
          const childParts=[...parts,x.title];
          const direct=x.kind==='folder'&&x.anchor&&folderKey(x.anchor)?x.anchor:null;
          if(direct){
            const child=await walk(direct,childParts,depth+1);
            complete&&=child.complete;child.keys.forEach(k=>keys.add(k));continue;
          }
          const anchored=x.kind==='file'&&editorRef(x.anchor);
          const archived=anchored&&d.files[anchored.key];
          if(archived?.status==='saved'&&await store.exists(archived.path,archived.bytes)){
            keys.add(anchored.key);continue;
          }
          await state('locating',{file:x.title,project:parts,item:index+1,total:rows.length});
          if(!sameListing(page.url(),backUrl))await go(page,backUrl);
          await waitUser(page,state,x.title,autoCaptcha);
          if(!sameListing(page.url(),backUrl))throw new Skip('Figma redirected while reopening the listing');
          const target=await openCard(page,ctx,x,x.kind);q=target.p;ref=target.ref;
          if(x.kind==='folder'){
            const child=await walk(q.url(),childParts,depth+1);
            complete&&=child.complete;child.keys.forEach(k=>keys.add(k));continue;
          }
          if(!ref||!editorRef(ref.url))throw new Skip('No native file editor (e.g. a prototype-only link)');
          const f=d.files[ref.key];
          if(f?.status!=='saved'||!(await store.exists(f.path,f.bytes))){
            if(f?.status==='saved')await store.update(r=>invalidateFiles(r,[ref.key]));
            let dest=parts;
            if(/\/recents-and-sharing\/(shared-with-you|recently-viewed)/.test(new URL(backUrl).pathname)){
              await waitReady(q,()=>heading(q),50000).catch(()=>{});
              const b=await firstVisible(q.locator('a[href*="/project/"],a[href*="/folder/"]'));
              const name=await b?.innerText().catch(()=>null);
              if(name?.trim())dest=[...parts,name.trim()];
            }
            exportAttempted=true;
            try {await exportNative(q,ref,x.title,dest,state,config);}
            finally {store.reload();}
          }
          const saved=(await store.read()).files[ref.key];
          if(saved?.status!=='saved'||!(await store.exists(saved.path,saved.bytes)))throw new Skip('No validated archive was recorded for this file');
          keys.add(ref.key);
        }catch(e){
          if(e instanceof Stop||page.isClosed())throw e;
          complete=false;
          await addIssue([...parts,x.title],e,ref,x.title);
        }finally{
          if(q!==page&&!q.isClosed())await q.close().catch(()=>{});
          // Only an actual export could leave a late download behind. Merely identifying an
          // already archived file must not close and reopen the main browser tab.
          if(exportAttempted&&q===page&&!page.isClosed()){
            const previous=page;
            page=await ctx.newPage();
            await previous.close().catch(()=>{});
          }
        }
      }
      const result={complete,keys:[...keys]};
      if(folderKey(u))await store.update(d=>recordFolder(d,backUrl,parts,result));
      results.set(key,result);
      return result;
    }finally{active.delete(folderKey(u)??localKey(u));}
  };
  await store.update(d=>{d.status='running';d.issues=[];delete d.pause_reason;});
  try {
    for(const scope of scopes){
      try {await walk(scope.url,scope.parts);}
      catch(e){if(e instanceof Stop||page.isClosed())throw e;await addIssue(scope.parts,e);}
    }
    await store.update(d=>{d.status=d.issues.length?'finished_with_issues':'finished';});
    const d=await store.read();
    return {phase:d.status,saved:Object.values(d.files).filter(x=>x.status==='saved').length,issues:d.issues.length,skippedFolders};
  }catch(e){await store.update(d=>{d.status='paused';d.pause_reason=e.message;});throw e;}
}
