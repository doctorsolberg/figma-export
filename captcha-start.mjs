import {setTimeout as sleep} from 'node:timers/promises';
export function trustedChallengeUrl(value) {
  try {
    const u=new URL(value), host=u.hostname;
    const figmaWaf=(host==='www.figma.com'||host==='figma.com') && u.pathname.replace(/\/$/,'')==='/waf-validation-captcha';
    return u.protocol==='https:' && !u.username && !u.password && !u.port && (figmaWaf||host==='verify.figma.com'||host==='arkoselabs.com'||host.endsWith('.arkoselabs.com'));
  } catch { return false; }
}
async function buttons(frame,label){
  const result=[];
  for(const locator of await frame.getByRole('button',{name:label,exact:true}).all()){
    if(await locator.isVisible()&&await locator.isEnabled())result.push(locator);
  }
  return result;
}
export async function autoStartChallenge(page){
  if(!['https://www.figma.com','https://figma.com'].includes(new URL(page.url()).origin))return false;
  const verify=await buttons(page,'Verify');
  if(verify.length!==1)return false;
  const existing=new Set(page.context().pages());
  // Only the popup opened by this page is eligible, never an unrelated tab.
  const pending=page.waitForEvent('popup',{timeout:18000}).catch(()=>null);
  await verify[0].click({timeout:4000});
  const popup=await pending;
  if(!popup||existing.has(popup))return false;
  return beginInPopup(popup);
}
export async function beginInPopup(popup){
  const deadline=Date.now()+15000;
  do {
    if(trustedChallengeUrl(popup.url())){
      const matches=[];
      for(const frame of popup.frames()){
        if(trustedChallengeUrl(frame.url()))matches.push(...await buttons(frame,/^Begin(?:\s*[>›→])?\s*$/i));
      }
      if(matches.length>1)return false;
      if(matches.length===1){
        // Activate the visible introductory control without OS pointer input or window activation.
        await matches[0].evaluate(button=>button.click(),null,{timeout:4000});
        return await matches[0].waitFor({state:'hidden',timeout:8000}).then(()=>true,()=>false);
      }
    }
    await sleep(450);
  } while(Date.now()<deadline);
  return false;
}
