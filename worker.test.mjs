import {test} from 'node:test';
import assert from 'node:assert/strict';
import {card, fileRef, classify, safeName, editorRef, canonicalCards, cardIdentity, waitForCards} from './worker.mjs';
test('waits for asynchronously hydrated cards instead of declaring them missing',async()=>{
 let reads=0;
 const result=await waitForCards(async()=>++reads<3?[]:['expected'],{timeout:50,interval:1});
 assert.deepEqual(result,['expected']); assert.equal(reads,3);
});
test('a truly empty list has a bounded wait',async()=>{
 assert.deepEqual(await waitForCards(async()=>[],{timeout:5,interval:1}),[]);
});
test('folder identity does not depend on relative update time',()=>{
 assert.equal(cardIdentity('VEEAM, folder icon color: Blue, Updated 22 hours ago'),cardIdentity('VEEAM, folder icon color: Blue, Updated 1 day ago'));
 assert.notEqual(cardIdentity('VEEAM, folder icon color: Blue, Updated 1 day ago'),cardIdentity('VEEAM, Design file'));
});
test('prototype playback has no native editor export',()=>{
 assert.equal(editorRef('https://www.figma.com/proto/ABC123/home'),null);
 assert.equal(editorRef('https://www.figma.com/board/ABC123/home').key,'ABC123');
});
test('folder wrappers are not extra cards; identical real files remain distinct',()=>{
 const name='B, folder icon color: Blue, Updated yesterday';
 const rows=[{label:name,actionable:false},{label:name,actionable:true},{label:'A, Design file',actionable:true},{label:'A, Design file',actionable:true}];
 assert.deepEqual(canonicalCards(rows).map(x=>[x.title,x.index]),[['B',0],['A',0],['A',1]]);
});
test('inventory preserves titles and identifies a Figma file',()=>{
 assert.deepEqual(card('invest in onbalance, Slides file'),{kind:'file',title:'invest in onbalance',label:'invest in onbalance, Slides file'});
 assert.equal(card('New Design file'),null);
 assert.equal(card('Project, folder icon color: Blue, Updated yesterday').title,'Project');
 assert.equal(fileRef('https://www.figma.com/slides/ABC123/name?t=private').key,'ABC123');
 assert.equal(fileRef('https://example.com/design/ABC123/a'),null);
});
test('a captcha is a pause, never a retry or a click',()=>{
 assert.equal(classify('https://www.figma.com/design/ABC123/a',{verification:true}),'verification');
 assert.equal(classify('https://www.figma.com/design/ABC123/a','Sign in to Figma'),'ready');
 assert.equal(classify('https://www.figma.com/waf-validation-captcha'),'verification');
 assert.equal(classify('https://www.figma.com/login','Sign in to Figma'),'login');
 assert.equal(classify('https://www.figma.com/design/ABC123/a','Normal editor'),'ready');
});
test('save names cannot escape the archive or hide a wrong format',()=>{
 assert.equal(safeName('Demo.deck'),'Demo.deck');
 for(const s of ['../Demo.deck','Demo.html','/Demo.fig','a\\b.fig']) assert.throws(()=>safeName(s));
});
