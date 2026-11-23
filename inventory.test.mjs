import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectInventory} from './inventory.mjs';
import {readInventory} from './inventory.mjs';
import {chromium} from 'playwright-core';
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
