import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exportFile} from './worker.mjs';
import {homedir} from 'node:os';

test('an editor redirect is rejected before opening its export menu', async()=>{
  const calls=[];
  const page={url:()=> 'https://www.figma.com/design/Wrong/other', goto:async()=>calls.push('goto'),
    on(){}, off(){}, isClosed:()=>false, locator:()=>({innerText:async()=>''}),
    getByRole(){calls.push('menu');throw Error('unexpected menu call');}};
  await assert.rejects(exportFile(page,{key:'Right',url:'https://www.figma.com/design/Right/expected'},'Expected',[],async()=>{},
    {root:homedir(),autoCaptcha:false}),/different file/);
  assert.deepEqual(calls,['goto']);
});
