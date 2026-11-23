import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exportFile} from './worker.mjs';
import {homedir} from 'node:os';
import {EventEmitter} from 'node:events';

test('an editor redirect is rejected before opening its export menu', async()=>{
  const calls=[];
  const page={url:()=> 'https://www.figma.com/design/Wrong/other', goto:async()=>calls.push('goto'),
    on(){}, off(){}, isClosed:()=>false, locator:()=>({innerText:async()=>''}),
    getByRole(){calls.push('menu');throw Error('unexpected menu call');}};
  await assert.rejects(exportFile(page,{key:'Right',url:'https://www.figma.com/design/Right/expected'},'Expected',[],async()=>{},
    {root:homedir(),autoCaptcha:false}),/different file/);
  assert.deepEqual(calls,['goto']);
});

test('an unfinished Chrome transfer is cancelled before a new export is attempted',async()=>{
  const url='https://www.figma.com/design/Fixture/native';
  const page=new EventEmitter();
  const calls=[];
  let clicks=0, cancelled=0;
  const download={url:()=>url,path:()=>new Promise(()=>{}),saveAs:()=>new Promise(()=>{}),cancel:async()=>{cancelled++;}};
  const loc={or:()=>loc,all:async()=>[loc],isVisible:async()=>true,isEnabled:async()=>true};
  Object.assign(page,{
    url:()=>url,isClosed:()=>false,locator:()=>loc,
    goto:async()=>{assert.equal(cancelled,1);calls.push('reopen');},
    getByRole:(_role,{name})=>name instanceof RegExp?{...loc,all:async()=>[{...loc,click:async()=>{
      if(++clicks===1)page.emit('download',download);
      else throw Error('Second attempt reached Save local copy');
    }}]}:loc,
  });
  loc.click=async()=>{};
  await assert.rejects(exportFile(page,{key:'Fixture',url},'Fixture',[],async phase=>calls.push(phase),
    {root:homedir(),autoCaptcha:false,transferTimeout:25}),/Second attempt reached/);
  assert.equal(cancelled,1);
  assert.deepEqual(calls,['exporting','downloading','retrying','reopen','exporting']);
  assert.equal(page.listenerCount('download'),0);
});
