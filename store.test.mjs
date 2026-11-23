import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,readFile,rm,mkdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {reportStore} from './worker.mjs';

test('each update keeps the previous valid report for manual recovery',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'figma-report-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=reportStore(dir);
  await store.update(d=>{d.status='old';});
  await store.update(d=>{d.status='new';});
  assert.equal(JSON.parse(await readFile(path.join(dir,'backup-report.json.bak'),'utf8')).status,'old');
  await writeFile(path.join(dir,'backup-report.json'),'{');
  await assert.rejects(reportStore(dir).read(),/restore.*\.bak/i);
});

test('archive checks accept a symlinked output root without accepting escapes',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'figma-report-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const actual=path.join(dir,'actual'), alias=path.join(dir,'alias');
  await mkdir(actual);
  await symlink(actual,alias);
  await writeFile(path.join(actual,'a.fig'),'fixture');
  await symlink(dir,path.join(actual,'escape'));
  const store=reportStore(alias);
  assert.equal(await store.exists('a.fig',7),true);
  assert.equal(await store.exists('escape/actual/a.fig',7),false);
});
