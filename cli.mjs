import {chromium} from 'playwright-core';
import {chmod,link,lstat,mkdir,realpath,rename,unlink,writeFile} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {options,help} from './config.mjs';
import {run} from './worker.mjs';

async function main(){
  const args=process.argv.slice(2), cfg=options(args);
  if(cfg.help){console.log(help);return;}
  const lock=fileURLToPath(new URL('./lock.py',import.meta.url));
  if(process.env.FIGMA_EXPORT_INTERNAL!=='1'){
    const child=spawn('python3',[lock,cfg.root,process.execPath,fileURLToPath(import.meta.url),...args],{stdio:'inherit',detached:true});
    const signals=['SIGINT','SIGTERM','SIGHUP'];
    const forward=()=>child.kill('SIGTERM');
    for(const signal of signals)process.on(signal,forward);
    try {process.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve(code??(signals.includes(signal)?130:1)));});}
    finally {for(const signal of signals)process.off(signal,forward);}
    return;
  }
  execFileSync('python3',[lock,'--verify',cfg.root],{stdio:['ignore','ignore','inherit',3]});
  await mkdir(cfg.profile,{recursive:true,mode:0o700});
  if((await lstat(cfg.profile)).isSymbolicLink() || await realpath(cfg.profile)!==cfg.profile)throw Error('Use a dedicated Chrome profile at a non-symlink path.');
  await chmod(cfg.profile,0o700);
  cfg.root=await realpath(cfg.root);
  if(cfg.profile===cfg.root||cfg.profile.startsWith(cfg.root+path.sep)||cfg.root.startsWith(cfg.profile+path.sep))throw Error('Profile and output must be separate directories.');
  const probe=path.join(cfg.root,'.report-'+randomUUID());
  try {
    await writeFile(probe,'',{mode:0o600,flag:'wx'});
    await link(probe,probe+'.link');
  } catch(e) {
    throw Error('The output directory must be writable and support hard links: '+e.code,{cause:e});
  } finally {
    await unlink(probe+'.link').catch(()=>{});
    await unlink(probe).catch(()=>{});
  }
  const state=async(phase,more={})=>{
    const target=path.join(cfg.root,'browser-status.json'), temp=target+'.'+randomUUID()+'.tmp';
    await writeFile(temp,JSON.stringify({phase,pid:process.pid,updatedAt:new Date().toISOString(),...more},null,2)+'\n',{mode:0o600,flag:'wx'});
    await rename(temp,target);
  };
  const ctx=await chromium.launchPersistentContext(cfg.profile,{channel:'chrome',headless:false,acceptDownloads:true,chromiumSandbox:true,handleSIGINT:false,handleSIGTERM:false,handleSIGHUP:false});
  let interrupted=false;
  for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.once(signal,()=>{interrupted=true;void ctx.close().catch(()=>{});});
  try{
    const page=ctx.pages()[0]??await ctx.newPage();
    const result=await run({page,ctx,state,config:cfg});
    await state(result.phase,result);console.log(JSON.stringify(result));
    if(result.issues)process.exitCode=2;
  }catch(e){await state('paused',{reason:interrupted?'Interrupted by signal':e.message});if(interrupted)process.exitCode=130;else throw e;}
  finally{await ctx.close().catch(()=>{});}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
