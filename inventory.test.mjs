import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectInventory} from './inventory.mjs';
import * as inventory from './inventory.mjs';
import {chromium} from 'playwright-core';
const {readInventory}=inventory;
const row=(label,position)=>({label,position,actionable:true});
test('a card outside the counted grid cannot satisfy its total',async t=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  t.after(()=>browser.close());
  const page=await browser.newPage();
  await page.setContent('<button aria-label="Outside, Design file">Outside</button><div role="grid" aria-rowcount="2"><button aria-label="Inside, Design file">Inside</button></div>');
  const result=await collectInventory(()=>readInventory(page),async()=>{},{stableMs:0});
  assert.equal(result.verified,false);
});
test('collects windowed rows without collapsing equal titles',async()=>{
  const rows=[row('Duplicate, Design file',1),row('Duplicate, Design file',2),row('Last, Design file',3)];
  const pages=[[rows[0],rows[1]],[rows[1],rows[2]],[rows[1],rows[2]]];
  const result=await collectInventory(async()=>({rows:pages.shift(),expected:3,busy:false,atEnd:pages.length<=1}),async()=>{},{interval:0,stableMs:0,maxRounds:3});
  assert.equal(result.verified,true);
  assert.deepEqual(result.cards.map(c=>[c.title,c.index]),[['Duplicate',0],['Duplicate',1],['Last',0]]);
});
test('quiet but uncounted inventories are not considered complete',async()=>{
  const result=await collectInventory(async()=>({rows:[row('A, Design file',1)],expected:null,busy:false}),async()=>{},{stableMs:0});
  assert.equal(result.verified,false);
});
test('seeing a different file at an already observed position cannot prove completeness',async()=>{
  const pages=[[row('A, Design file',1)],[row('B, Design file',1),row('C, Design file',2)]];
  const result=await collectInventory(async()=>({rows:pages.shift(),expected:2,busy:false}),async()=>{},{interval:0,maxRounds:2});
  assert.equal(result.verified,false);
});

test('two cards in a single grid row cannot establish a two-row total',async()=>{
  const rows=[row('A, Design file',1),row('B, Design file',1)];
  const result=await collectInventory(async()=>({rows,expected:2,busy:false,atEnd:true}),async()=>{},{interval:0,stableMs:0,maxRounds:3});
  assert.equal(result.verified,false);
  assert.equal(result.cards.length,2);
});

test('a matching loaded count before the end never closes an inventory',async()=>{
  const result=await collectInventory(async()=>({rows:[row('A, Design file',1)],expected:1,busy:false,atEnd:false}),async()=>{},{interval:0,stableMs:0,maxRounds:3});
  assert.equal(result.verified,false);
});

test('a transient zero does not stop discovery before hydration',async()=>{
  const photos=[[],[],[row('A, Design file',1)],[row('A, Design file',1)]];
  const result=await collectInventory(async()=>{
    const rows=photos.shift();return {rows,expected:rows.length,busy:false,atEnd:true};
  },async()=>{},{interval:0,stableMs:0,maxRounds:4});
  assert.equal(result.cards.length,1);
  assert.equal(result.verified,false);
});

test('card recovery can find a card above the current virtual window',async t=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  t.after(()=>browser.close());
  const page=await browser.newPage();
  await page.setContent(`<div id="scroll" style="height:100px;overflow:auto;overflow-anchor:none"><div style="height:900px">
    <button id="card" aria-label="Last, Design file">Card</button>
  </div></div><script>
  const scroller=document.querySelector('#scroll'), card=document.querySelector('#card');
  scroller.onscroll=()=>{
    card.style.marginTop=scroller.scrollTop+'px';
    card.setAttribute('aria-label',scroller.scrollTop<80?'First, Design file':'Last, Design file');
  };
  scroller.scrollTop=800;
  </script>`);
  await page.waitForFunction(()=>document.querySelector('#scroll').scrollTop===800);
  assert.equal(await inventory.findCard(page,'First, Design file',0),null);
  const found=await inventory.recoverCard(page,{label:'First, Design file',index:0,position:null});
  assert.equal(await found?.getAttribute('aria-label'),'First, Design file');
  assert.equal(await page.locator('#scroll').evaluate(e=>e.scrollTop),0);
});

test('Figma virtual list indexes distinguish identical titles across windows without proving coverage',async t=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  t.after(()=>browser.close());
  const page=await browser.newPage();
  await page.setContent(`<div role="list" style="height:100px;overflow:auto;overflow-anchor:none"><div style="height:320px">
    <div role="listitem" data-index="0"><button data-card-main-action="true" aria-label="Same, Design file">Card</button></div>
  </div></div><script>
  const scroller=document.querySelector('[role=list]'), row=document.querySelector('[role=listitem]');
  scroller.onscroll=()=>{
    row.style.marginTop=scroller.scrollTop+'px';
    row.dataset.index=scroller.scrollTop>=100?'7':'0';
  };
  </script>`);
  const result=await inventory.scanInventory(page,{interval:100,stableMs:350,maxRounds:15});
  assert.deepEqual(result.cards.map(x=>x.virtualIndex),['0','7']);
  assert.equal(result.verified,false);
  const first=await inventory.recoverCard(page,result.cards[0]);
  assert.equal(await first?.evaluate(e=>e.closest('[role=listitem]').dataset.index),'0');
});

test('toolbar links and empty row wrappers do not count as file cards',async t=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  t.after(()=>browser.close());
  const page=await browser.newPage();
  await page.setContent(`<div role="grid" aria-rowcount="1">
    <a href="https://example.test/help">Help</a>
    <div role="row" aria-rowindex="1"><button data-card-main-action="true" aria-label="Actual, Design file">Actual</button></div>
  </div>`);
  const result=await readInventory(page);
  assert.deepEqual(result.rows.map(x=>x.label),['Actual, Design file']);
});

test('a reused virtual row keeps both observed cards and cannot prove coverage',async()=>{
  const snapshots=[
    [{...row('First, Design file',null),virtualIndex:'0'}],
    [{...row('Second, Design file',null),virtualIndex:'0'}],
  ];
  const result=await collectInventory(async()=>({rows:snapshots.shift(),expected:null,busy:false,atEnd:true}),
    async()=>{},{interval:0,maxRounds:2});
  assert.deepEqual(result.cards.map(x=>x.title),['First','Second']);
  assert.equal(result.verified,false);
});

test('a quiet window does not stop a scan while scrolling still advances',async()=>{
  let offset=0;
  const result=await collectInventory(async()=>({
    rows:[row(offset<5?'First, Design file':'Last, Design file',offset<5?1:2)],
    expected:null,busy:false,atEnd:offset>=5,
  }),async()=>offset<5&&++offset>0,{interval:0,stableMs:0,maxRounds:8});
  assert.deepEqual(result.cards.map(x=>x.title),['First','Last']);
  assert.equal(result.verified,false);
});

test('card recovery waits for file cards to hydrate after returning to a listing',async t=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  t.after(()=>browser.close());
  const page=await browser.newPage();
  await page.setContent(`<button aria-label="Create a file">Create</button><script>
    setTimeout(()=>document.body.insertAdjacentHTML('beforeend','<div role="list"><div role="listitem" data-index="1"><button data-card-main-action="true" aria-label="Target, Design file">Target</button></div></div>'),300);
  </script>`);
  const found=await inventory.recoverCard(page,{label:'Target, Design file',index:0,virtualIndex:'1'},2000);
  assert.equal(await found?.textContent(),'Target');
});

test('inventory distinguishes an unlabelled main action from a row without a file control',async t=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  t.after(()=>browser.close());
  const page=await browser.newPage();
  await page.setContent(`<div role="grid" aria-rowcount="2">
    <div role="row" aria-rowindex="1"><button data-card-main-action="true">Untyped action</button></div>
    <div role="row" aria-rowindex="2">Untyped row</div>
  </div>`);
  const {unknown,coverageGap}=await collectInventory(()=>readInventory(page),async()=>false,{interval:0,maxRounds:1});
  assert.deepEqual(unknown.map(x=>x.evidence),[
    {tag:'button',role:null,mainAction:true,row:'1',virtualIndex:null},
    {tag:'div',role:'row',mainAction:false,row:'2',virtualIndex:null},
  ]);
  assert.equal(coverageGap,'unresolved_entries');
});

test('an unverified listing reports why coverage could not be proven',async()=>{
  const run=snap=>collectInventory(async()=>snap,async()=>false,{interval:0,maxRounds:1});
  assert.equal((await run({rows:[row('A, Design file',1)],expected:null,busy:false,atEnd:false})).coverageGap,'no_reliable_total');
  assert.equal((await run({rows:[row('A, Design file',1)],expected:2,busy:false,atEnd:true})).coverageGap,'incomplete_rows');
});

test('a moving card resolves by its unique label, but an ambiguous label is not guessed',async t=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  t.after(()=>browser.close());
  const page=await browser.newPage();
  await page.setContent(`<div role="list">
    <div role="listitem" data-index="0"><button data-card-main-action="true" aria-label="Other, Design file">Other</button></div>
    <div role="listitem" data-index="1"><button data-card-main-action="true" aria-label="Target, Design file">Target</button></div>
  </div>`);
  const stale={label:'Target, Design file',index:0,position:null,virtualIndex:'0'};
  const scan={interval:20,stableMs:40,maxRounds:8};
  const found=await inventory.relocateUniqueCard(page,stale,scan);
  assert.equal(await found?.textContent(),'Target');
  await page.locator('[data-index="0"] button').evaluate(e=>e.setAttribute('aria-label','Target, Design file'));
  assert.equal(await inventory.relocateUniqueCard(page,stale,scan),null);
});
