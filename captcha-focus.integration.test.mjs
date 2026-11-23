import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {beginInPopup} from './captcha-start.mjs';

test('Begin changes only the intro screen without focusing it or solving the challenge',async t=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  t.after(()=>browser.close());
  const ctx=await browser.newContext(), popup=await ctx.newPage();
  await ctx.route('https://www.figma.com/waf-validation-captcha',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`
  <button onclick="document.querySelector('#challenge').hidden=false;this.remove()">Begin ›</button>
  <button hidden onclick="this.dataset.answered='yes'" id="challenge">Challenge answer</button>`}));
  await popup.goto('https://www.figma.com/waf-validation-captcha');
  assert.equal(new URL(popup.url()).pathname,'/waf-validation-captcha');
  assert.equal(await popup.getByRole('button',{name:/^Begin/}).count(),1,await popup.locator('body').innerText());
  assert.equal(await popup.getByRole('button',{name:/^Begin(?:\s*[>›→])?\s*$/i}).count(),1,await popup.locator('body').ariaSnapshot());
  assert.equal(popup.frames()[0].url(),popup.url());
  assert.equal(await popup.getByRole('button',{name:/^Begin/}).isVisible(),true);
  assert.equal(await popup.getByRole('button',{name:/^Begin/}).isEnabled(),true);
  await popup.evaluate(()=>{
    window.focusEvents=[];
    document.addEventListener('focus',e=>window.focusEvents.push(e.target.tagName),true);
  });
  assert.equal(await beginInPopup(popup),true);
  assert.deepEqual(await popup.evaluate(()=>window.focusEvents),[]);
  assert.equal(await popup.locator('#challenge').isVisible(),true);
  assert.equal(await popup.locator('#challenge').getAttribute('data-answered'),null);
  // The synthetic click must not focus the challenge control.
  assert.equal(await popup.evaluate(()=>document.activeElement.id),'');
});
