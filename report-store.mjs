import {readFile,lstat,realpath,link,rename,unlink,open} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

export class Stop extends Error {}
export class Skip extends Error {}

async function syncDirectory(directory) {
  const handle = await open(directory,'r');
  try {await handle.sync();}
  catch(e){if(!['EINVAL','ENOTSUP','EBADF'].includes(e.code))throw e;}
  finally {await handle.close();}
}

export function reportStore(root) {
  const filename=path.join(root,'backup-report.json');
  const backup=filename+'.bak';
  let current;
  async function read() {
    if(current)return current;
    try {
      const info=await lstat(filename);
      if(!info.isFile())throw new Stop('The backup report is not a regular file');
      const decoded=JSON.parse(await readFile(filename,'utf8'));
      if(!decoded||!decoded.files||typeof decoded.files!=='object'||Array.isArray(decoded.files)||!Array.isArray(decoded.issues))throw new SyntaxError('Invalid report shape');
      current=decoded;
    } catch(e) {
      if(e instanceof SyntaxError)throw new Stop('Invalid backup-report.json; stop the exporter and restore a valid backup-report.json.bak before restarting.',{cause:e});
      if(e.code!=='ENOENT')throw e;
      current={files:{},issues:[],completedFolders:{}};
    }
    return current;
  }
  async function update(change) {
    const next=structuredClone(await read());
    change(next);
    const tmp=filename+'.'+randomUUID()+'.tmp';
    const previous=tmp+'.bak';
    try {
      const handle=await open(tmp,'wx',0o600);
      try {await handle.writeFile(JSON.stringify(next,null,2)+'\n');await handle.sync();}
      finally {await handle.close();}
      try {await link(filename,previous);await rename(previous,backup);}
      catch(e){if(e.code!=='ENOENT')throw e;}
      await rename(tmp,filename);
      await syncDirectory(root);
      current=next;
    } finally {
      await unlink(tmp).catch(()=>{});
      await unlink(previous).catch(()=>{});
    }
  }
  async function exists(relative,bytes) {
    if(typeof relative!=='string'||path.isAbsolute(relative)||relative.split(/[\\/]/).some(s=>s==='..'||!s))return false;
    try {
      const canonicalRoot=await realpath(root);
      const filename=path.join(canonicalRoot,relative);
      const resolved=await realpath(filename), info=await lstat(filename);
      return resolved===filename&&info.isFile()&&info.size>0&&(bytes===undefined||info.size===bytes);
    } catch {return false;}
  }
  return {read,update,exists,reload:()=>{current=undefined;}};
}
