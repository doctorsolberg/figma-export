const origins=new Set(['https://www.figma.com','https://figma.com']);
export function folderKey(value){
  try {
    const u=new URL(value);
    if(!origins.has(u.origin)||u.username||u.password)return null;
    const m=/^\/files\/team\/(\d+)\/(?:folder|project)\/(\d+)\/?$/.exec(u.pathname);
    return m?`team:${m[1]}/folder:${m[2]}`:null;
  } catch {return null;}
}
const validResult=r=>r.complete===true&&Array.isArray(r.keys);
export function forgetFolder(report,url){
  const id=folderKey(url);
  if(!id||!report.completedFolders)return;
  const item=report.completedFolders[id];
  delete report.completedFolders[id];
  if(!Array.isArray(item?.parts))return;
  for(const [key,parent] of Object.entries(report.completedFolders)){
    if(Array.isArray(parent?.parts)&&parent.parts.length<item.parts.length&&parent.parts.every((p,i)=>p===item.parts[i]))delete report.completedFolders[key];
  }
}
export function recordFolder(report,url,parts,result){
  const id=folderKey(url);
  if(!id)return;
  const old=report.completedFolders?.[id];
  if(old)forgetFolder(report,url);
  if(!validResult(result)||result.keys.some(key=>report.files[key]?.status!=='saved'))return;
  const u=new URL(url); u.search='';u.hash='';
  (report.completedFolders??={})[id]={version:3,url:u.href,parts:[...parts],keys:[...new Set(result.keys)],completedAt:new Date().toISOString()};
}
export async function reusableFolder(report,url,parts,exists,{rescan=false}={}){
  if(rescan)return null;
  const id=folderKey(url), item=id&&report.completedFolders?.[id];
  if(item?.version!==3||folderKey(item.url)!==id||JSON.stringify(item.parts)!==JSON.stringify(parts))return null;
  if(!Array.isArray(item.keys))return null;
  for(const k of item.keys){const f=report.files[k];if(f?.status!=='saved'||!(await exists(f.path,f.bytes)))return null;}
  return {complete:true,keys:item.keys};
}
export function invalidateFiles(report,keys){
  const set=new Set(keys);
  for(const [id,r] of Object.entries(report.completedFolders??{}))if(Array.isArray(r?.keys)&&r.keys.some(k=>set.has(k)))delete report.completedFolders[id];
}
