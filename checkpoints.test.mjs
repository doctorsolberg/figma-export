import {test} from 'node:test';
import assert from 'node:assert/strict';
import {folderKey, recordFolder, reusableFolder, forgetFolder, invalidateFiles} from './checkpoints.mjs';
const folder='https://www.figma.com/files/team/123/folder/456?fuid=999';
const nested='https://www.figma.com/files/team/123/folder/789';
const saved={A:{status:'saved',path:'Team/Design/a.fig'},B:{status:'saved',path:'Team/Design/Nested/b.fig'}};
const result={complete:true,keys:['A','B']};
const parts=['Team','Design'];
const exists=async p=>['Team/Design/a.fig','Team/Design/Nested/b.fig'].includes(p);
test('only project/folder pages have canonical IDs; aliases match and queries disappear',()=>{
  assert.equal(folderKey(folder),folderKey('https://figma.com/files/team/123/project/456'));
  assert.notEqual(folderKey(folder),folderKey(nested));
  assert.equal(folderKey('https://www.figma.com/files/team/123/all-folders'),null);
  assert.equal(folderKey('https://example.org/files/team/123/folder/456'),null);
  assert.equal(folderKey('https://www.figma.com/files/team/123/folder/456/extra'),null);
});
test('complete folder with verified files can resume; mode and output path matter',async()=>{
  const report={files:saved};
  recordFolder(report,folder,parts,result);
  assert.deepEqual(await reusableFolder(report,folder,parts,exists),result);
  assert.equal(await reusableFolder(report,folder,parts,exists,{rescan:true}),null);
  assert.equal(await reusableFolder(report,folder,['Other','Design'],exists),null);
  assert.equal(await reusableFolder(report,folder,parts,async p=>p.endsWith('a.fig')),null);
  forgetFolder(report,folder);
  assert.equal(await reusableFolder(report,folder,parts,exists),null);
});
test('unfinished and unsaved inventories are not cached',async()=>{
  const report={files:{A:saved.A}};
  for(const r of [{complete:false,keys:['A']},{complete:false,keys:[]},{complete:true,keys:['B']}] ) {
    recordFolder(report,folder,parts,r);
    assert.equal(await reusableFolder(report,folder,parts,exists),null);
  }
});
test('a removed archive invalidates every completed folder referencing it',()=>{
  const report={files:saved};
  recordFolder(report,folder,parts,result);
  recordFolder(report,nested,[...parts,'Nested'],{complete:true,keys:['B']});
  invalidateFiles(report,['B']);
  assert.equal(Object.keys(report.completedFolders).length,0);
});

test('malformed legacy markers are removed before visiting a folder',()=>{
  const other=folderKey(nested);
  const report={files:saved,completedFolders:{[folderKey(folder)]:{version:1},[other]:{parts:['Other']}}};
  forgetFolder(report,folder);
  assert.deepEqual(Object.keys(report.completedFolders),[other]);
});
