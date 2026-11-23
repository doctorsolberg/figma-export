import {test} from 'node:test';
import assert from 'node:assert/strict';
import {trustedChallengeUrl, autoStartChallenge} from './captcha-start.mjs';
test('only Figma verification and genuine Arkose HTTPS origins qualify',()=>{
 for(const u of ['https://verify.figma.com/','https://client-api.arkoselabs.com/fc/','https://www.figma.com/waf-validation-captcha?continue=x','https://figma.com/waf-validation-captcha']) assert.equal(trustedChallengeUrl(u),true);
 for(const u of ['http://verify.figma.com/','https://verify.figma.com.evil.test/','https://arkoselabs.com.evil.test/','https://www.figma.com/design/a','https://www.figma.com/waf-validation-captcha-other']) assert.equal(trustedChallengeUrl(u),false);
});
test('only trusted unique Begin after Verify; no picture clicks',async()=>{
 const actions=[];
 const button=t=>({isVisible:async()=>true,isEnabled:async()=>true,click:async()=>actions.push(t)});
 const frame=(u,names)=>({url:()=>u,getByRole:(role,{name,exact})=>({all:async()=>{assert.equal(role,'button');if(typeof name==='string')assert.equal(exact,true);return names.filter(t=>typeof name==='string'?t===name:name.test(t)).map(t=>({...button(t),evaluate:async (fn,_,opts)=>{assert.ok(opts.timeout);fn({click:()=>actions.push('Begin')});},waitFor:async({state})=>assert.equal(state,'hidden')}));}})});
 const popup={url:()=> 'https://www.figma.com/waf-validation-captcha',frames:()=>[frame('https://unknown.test/',['Begin']),frame('https://www.figma.com/waf-validation-captcha',['Begin ›','Picture'])]};
 const initiator={...frame('https://www.figma.com/design/a',['Verify']),context:()=>({pages:()=>[initiator]}),waitForEvent:async()=>popup};
 assert.equal(await autoStartChallenge(initiator),true);
 assert.deepEqual(actions,['Verify','Begin']);
});
