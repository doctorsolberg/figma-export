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

test('the locked browser worker saves a real Chrome download and records its checksum',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'figma-native-download-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const source=`
 import {chromium} from 'playwright-core';
 import {exportFile,reportStore} from './worker.mjs';
 import {realpath} from 'node:fs/promises';
 const [input,data]=process.argv.slice(1);
 const root=await realpath(input);await reportStore(root).update(d=>{d.status='running';});
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
   const ctx=await browser.newContext({acceptDownloads:true});
   const page=await ctx.newPage();
   const url='https://www.figma.com/design/Fixture/native';
   await ctx.route(url,r=>r.fulfill({contentType:'text/html; charset=utf-8',body:\`
     <button aria-label="Main menu" onclick="document.querySelector('#file').hidden=false">Main menu</button>
     <button id="file" role="menuitem" hidden onclick="document.querySelector('#save').hidden=false">File</button>
     <button id="save" role="menuitem" hidden onclick="window.location.href='/fixture-download'">Save local copy</button>\`}));
   await ctx.route('https://www.figma.com/fixture-download',r=>r.fulfill({body:Buffer.from(data,'base64'),headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename=Fixture.fig'}}));
   await page.goto(url);
   await exportFile(page,{key:'Fixture',url},'Fixture',['Example'],async()=>{},{root,autoCaptcha:false,downloadTimeout:3000});
 }finally{await browser.close();}`;
 const zip=execFileSync('python3',['-c','import io,json,zipfile,sys; b=io.BytesIO(); z=zipfile.ZipFile(b,"w"); z.writestr("canvas.fig",b"fixture"); z.writestr("meta.json",json.dumps({"file_name":"Fixture"})); z.close(); sys.stdout.buffer.write(b.getvalue())']);
 const script=path.join(root,'fixture.mjs');
 await (await import('node:fs/promises')).writeFile(script,source.replaceAll("from 'playwright-core'",`from ${JSON.stringify(import.meta.resolve('playwright-core'))}`).replaceAll("from './worker.mjs'",`from ${JSON.stringify(new URL('./worker.mjs',import.meta.url).href)}`).replace('process.argv.slice(1)','process.argv.slice(2)'));
 await exec('python3',['lock.py',root,process.execPath,script,root,zip.toString('base64')],{cwd:here,timeout:12_000});
 const report=JSON.parse(await readFile(path.join(root,'backup-report.json'),'utf8'));
 assert.equal(report.files.Fixture.path,'Example/Fixture.fig');
 assert.match(report.files.Fixture.sha256,/^[a-f0-9]{64}$/);
 assert.deepEqual(await readFile(path.join(root,'Example','Fixture.fig')),zip);
});
