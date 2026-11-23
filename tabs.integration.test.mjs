import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {run} from './worker.mjs';

test('already archived cards use their editor IDs, not an unrelated Copy link, without tab churn',async t=>{
  const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'figma-tabs-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const browser=await chromium.launch({channel:'chrome',headless:true});
  t.after(()=>browser.close());
  const ctx=await browser.newContext();
  const page=await ctx.newPage();
  let opened=0;
  let editorLoads=0;
  ctx.on('page',()=>opened++);
  const folder='https://www.figma.com/files/team/123/folder/456';
  const cards=['A','B'].map((key,i)=>`<div role="row" aria-rowindex="${i+1}"><button aria-label="${key}, Design file" oncontextmenu="document.querySelector('#copy').hidden=false;event.preventDefault()" ondblclick="location.href='/design/${key}/fixture'">${key}</button></div>`).join('');
  await ctx.route('https://www.figma.com/**',r=>{
    const isFolder=r.request().url()===folder;
    if(!isFolder)editorLoads++;
    return r.fulfill({contentType:'text/html',body:isFolder?`<button>Recents</button><div role="grid" aria-rowcount="2">${cards}</div><button id="copy" hidden onclick="this.hidden=true;navigator.clipboard.writeText(location.origin+'/design/A/fixture')">Copy link</button>`:'<h1>Editor fixture</h1>'});
  });
  await Promise.all(['A','B'].map(key=>writeFile(path.join(root,`${key}.fig`),key)));
  await writeFile(path.join(root,'backup-report.json'),JSON.stringify({issues:[],files:Object.fromEntries(['A','B'].map(key=>[key,{status:'saved',path:`${key}.fig`,bytes:1}]))}));
  const locating=[];
  const result=await run({page,ctx,state:async(phase,data)=>{if(phase==='locating')locating.push([data.item,data.total]);},config:{root,scopes:[{url:folder,parts:['Team','Folder']}],autoCaptcha:false},exportNative:async()=>assert.fail('Already saved file should not be exported')});
  assert.equal(result.issues,0);
  assert.equal(opened,0);
  assert.equal(editorLoads,2);
  assert.deepEqual(locating,[[1,2],[2,2]]);
  const report=JSON.parse(await readFile(path.join(root,'backup-report.json'),'utf8'));
  assert.deepEqual(Object.values(report.completedFolders)[0].keys,['A','B']);
  assert.equal(page.isClosed(),false);
});
