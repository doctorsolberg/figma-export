import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';
import {run} from './worker.mjs';
import {folderKey} from './checkpoints.mjs';
const base='https://www.figma.com/files/team/123';
const scope={url:base+'/all-folders',parts:['Team']};
const project=base+'/folder/456';
const folderHTML=rows=>{
 const cards=rows.match(/<a\b[^>]*>.*?<\/a>/g)??[];
 return '<button>Recents</button><div role="grid" aria-rowcount="'+cards.length+'">'+cards.map((card,i)=>`<div role="row" aria-rowindex="${i+1}">${card}</div>`).join('')+'</div>';
};
const fileHTML=(key,title)=>`<a aria-label="${title}, Design file" href="https://www.figma.com/design/${key}/example">${title}</a>`;
test('first scan persists a folder; resume avoids its page; rescan finds a new file',async t=>{
 const scratch=process.env.FIGMA_TEST_TMP??path.join(homedir(),'.cache');
 await mkdir(scratch,{recursive:true}); const root=await mkdtemp(path.join(scratch,'figma-export-test-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());
 const ctx=await browser.newContext({acceptDownloads:true}), page=await ctx.newPage();
 let visits=0,revision=0;

 await ctx.route('**/*',async r=>{
   const url=r.request().url();
   if(url===scope.url)return r.fulfill({contentType:'text/html',body:folderHTML(`<a href="${project}" aria-label="Design, folder icon color: Blue, Updated just now">Design</a>`)});
   if(url===project){visits++;return r.fulfill({contentType:'text/html',body:folderHTML(fileHTML('A','A')+(revision?fileHTML('B','B'):'')+(revision===2?fileHTML('C','C'):'')+(revision===3?'<a aria-label="Unknown, Whiteboard file">Unknown</a>':''))});}
   if(url.startsWith('https://www.figma.com/design/'))return r.fulfill({contentType:'text/html',body:'<button aria-label="Main menu">Main menu</button>'});
   return r.abort();
 });
 await mkdir(path.join(root,'Team','Design'),{recursive:true});
 await writeFile(path.join(root,'Team','Design','a.fig'),'fixture representing an existing verified copy');
 const report=path.join(root,'backup-report.json');
 await writeFile(report,JSON.stringify({files:{A:{status:'saved',path:'Team/Design/a.fig'}},issues:[]}));
 const exportNative=async (_p,ref,title,parts)=>{
   if(ref.key==='C')throw Error('Fixture: export blocked');
   assert.equal(ref.key,'B');
   const stage=path.join(root,'.playwright-b.fig');
   execFileSync('python3',['-c','import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1],"w"); z.writestr("canvas.fig",b"fixture"); z.writestr("meta.json",json.dumps({"file_name":sys.argv[2]})); z.close()',stage,title]);
   execFileSync('python3',['lock.py',root,'python3','archive.py',root,stage,ref.key,ref.url,title,'.fig',JSON.stringify(parts)]);
 };
 const execute=(rescan,scopes=[scope])=>run({page,ctx,state:async()=>{},config:{root,scopes,rescan,autoCaptcha:false},exportNative});
 assert.equal((await execute(false)).issues,0);
 assert.equal(visits,1);
 assert.deepEqual(JSON.parse(await readFile(report)).completedFolders[folderKey(project)].keys,['A']);
 assert.equal((await execute(false)).skippedFolders,1);
 assert.equal(visits,1);
 revision=1;
 const result=await execute(true);
 assert.ok(visits>1);assert.equal(result.skippedFolders,0);assert.equal(result.issues,0);
 const refreshed=JSON.parse(await readFile(report));
 assert.equal(refreshed.files.B.status,'saved');assert.equal(refreshed.files.B.path,'Team/Design/B.fig');
 assert.deepEqual(refreshed.completedFolders[folderKey(project)].keys,['A','B']);
 revision=2;
 assert.equal((await execute(true,[{url:project,parts:['Team','Design']}])).issues,1);
 const latest=JSON.parse(await readFile(report));
 assert.equal(latest.files.C.status,'not_saved');assert.equal(latest.completedFolders[folderKey(project)],undefined);
 revision=3;
 assert.equal((await execute(true,[{url:project,parts:['Team','Design']}])).issues,1);
 assert.match(JSON.parse(await readFile(report)).issues[0].reason,/Whiteboard file/);
 assert.equal(JSON.parse(await readFile(report)).completedFolders[folderKey(project)],undefined);
 const redirect=base+'/recents-and-sharing/shared-with-you';
 await ctx.route(redirect,r=>r.fulfill({contentType:'text/html',body:`<script>history.replaceState(null,'',${JSON.stringify(scope.url)})</script>`+folderHTML('')}));
 assert.equal((await execute(false,[{url:redirect,parts:['Shared']}])).issues,1);
 assert.match(JSON.parse(await readFile(report)).issues[0].reason,/redirected/i);
});
