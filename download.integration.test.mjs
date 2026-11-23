import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
const exec=promisify(execFile);
const here=path.dirname(fileURLToPath(import.meta.url));

async function checkDownload(t,mode){
 const root=await mkdtemp(path.join(tmpdir(),'figma-native-download-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const source=`
 import {chromium} from 'playwright-core';
 import {exportFile,reportStore} from './worker.mjs';
 import {realpath} from 'node:fs/promises';
 const [input,data,mode]=process.argv.slice(1);
 const root=await realpath(input);await reportStore(root).update(d=>{d.status='running';});
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
   const ctx=await browser.newContext({acceptDownloads:true});
   const page=await ctx.newPage();
   const url='https://www.figma.com/design/Fixture/native';
   await ctx.route(url,r=>r.fulfill({contentType:'text/html; charset=utf-8',body:\`
     <button aria-label="Main menu" onclick="
       if ('\${mode}'==='verification' && !sessionStorage.verified){
         document.querySelector('#challenge').hidden=false;
       } else document.querySelector('#file').hidden=false;
     ">Main menu</button>
     <div id="challenge" role="dialog" hidden>Figma needs to verify you are not a bot</div>
     <button id="file" role="menuitem" hidden onclick="document.querySelector('#save').hidden=false">File</button>
     <button id="save" role="menuitem" hidden onclick="
       const first=!sessionStorage.started;
       sessionStorage.started='1';
       if(first && '\${mode}'==='reload')setTimeout(()=>location.reload(),100);
       else window.location.href='/fixture-download';
     ">Save local copy</button>\`}));
   await ctx.route('https://www.figma.com/fixture-download',r=>r.fulfill({body:Buffer.from(data,'base64'),headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename=Fixture.fig'}}));
   await page.goto(url);
   if(mode==='click-error'){
     const getByRole=page.getByRole.bind(page);
     page.getByRole=(role,options)=>{
       const loc=getByRole(role,options);
       if(!(options.name instanceof RegExp))return loc;
       const all=loc.all.bind(loc);
       loc.all=async()=>{
         const matches=await all();
         for(const match of matches){
           const click=match.click.bind(match);
           match.click=async options=>{
             await Promise.all([page.waitForEvent('download',{timeout:3000}),click(options)]);
             throw Error('Save click was interrupted after emitting a download');
           };
         }
         return matches;
       };
       return loc;
     };
   }
   const phases=[];
   await exportFile(page,{key:'Fixture',url},'Fixture',['Example'],async phase=>{
     phases.push(phase);
     // Simulate the operator dismissing a synthetic challenge only after the handoff occurs.
     if(phase==='verification')await page.evaluate(()=>{
       sessionStorage.verified='1';document.querySelector('#challenge').hidden=true;
     });
   },{root,autoCaptcha:false,downloadTimeout:3000});
   console.log('ATTEMPTS='+phases.filter(p=>p==='exporting').length);
   console.log('VERIFICATIONS='+phases.filter(p=>p==='verification').length);
 }finally{await browser.close();}`;
 const zip=execFileSync('python3',['-c','import io,json,zipfile,sys; b=io.BytesIO(); z=zipfile.ZipFile(b,"w"); z.writestr("canvas.fig",b"fixture"); z.writestr("meta.json",json.dumps({"file_name":"Fixture"})); z.close(); sys.stdout.buffer.write(b.getvalue())']);
 const script=path.join(root,'fixture.mjs');
 await (await import('node:fs/promises')).writeFile(script,source.replaceAll("from 'playwright-core'",`from ${JSON.stringify(import.meta.resolve('playwright-core'))}`).replaceAll("from './worker.mjs'",`from ${JSON.stringify(new URL('./worker.mjs',import.meta.url).href)}`).replace('process.argv.slice(1)','process.argv.slice(2)'));
 const {stdout}=await exec('python3',['lock.py',root,process.execPath,script,root,zip.toString('base64'),mode],{cwd:here,timeout:18_000});
 const report=JSON.parse(await readFile(path.join(root,'backup-report.json'),'utf8'));
 assert.equal(report.files.Fixture.path,'Example/Fixture.fig');
 assert.match(report.files.Fixture.sha256,/^[a-f0-9]{64}$/);
 assert.deepEqual(await readFile(path.join(root,'Example','Fixture.fig')),zip);
 assert.match(stdout,['reload','verification'].includes(mode)?/ATTEMPTS=2\b/:/ATTEMPTS=1\b/);
 assert.match(stdout,mode==='verification'?/VERIFICATIONS=1\b/:/VERIFICATIONS=0\b/);
}

test('the locked browser worker saves a real Chrome download and records its checksum',t=>checkDownload(t,'normal'));
test('reloading the same editor URL restarts the interrupted export',t=>checkDownload(t,'reload'));
test('a Save click error does not discard the download it already started',t=>checkDownload(t,'click-error'));
test('verification appearing while opening the menu is handed to the operator',t=>checkDownload(t,'verification'));
