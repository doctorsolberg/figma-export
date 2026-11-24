import {parseArgs} from 'node:util';
import {homedir} from 'node:os';
import path from 'node:path';

export const defaultExportTimeoutMinutes=20;

export const help=`Figma Export — save importable native copies through Figma's editor

Usage: npm start -- --team "NAME=TEAM_ID" [--team "NAME=TEAM_ID" ...]
       npm start -- --scope "NAME=https://www.figma.com/files/..." [options]

  --team NAME=ID_OR_URL     Scan the team's All folders view (repeatable).
  --scope NAME=FIGMA_URL   Scan a folder, Drafts, Shared files, or other Figma
                          file-browser listing (repeatable). Use / in NAME
                          to build a directory path; e.g. Team/Project.
  --out DIRECTORY         Output root (default: ~/Downloads/Figma backup).
  --profile DIRECTORY     Dedicated Chrome profile (default: per-user).
  --rescan                Ignore completed-folder checkpoints; rediscover
                          files, but do not replace existing copies.
  --export-timeout-minutes N
                          Wait up to N minutes for preparation and, separately,
                          transfer (1–120; default: ${defaultExportTimeoutMinutes}).
  --manual-start-captcha  Leave Verify and Begin to the user as well.
  --help                  Show this help.
`;
export function browserListing(value){
  try {
    const u=new URL(value);
    return ['https://www.figma.com','https://figma.com'].includes(u.origin)&&!u.username&&!u.password&&u.pathname.startsWith('/files/') ? u:null;
  } catch {return null;}
}
function pair(value){
  const i=value.indexOf('=');
  if(i<1||!value.slice(i+1).trim())throw Error('Expected NAME=VALUE: '+value);
  const names=value.slice(0,i).split('/').map(x=>x.trim());
  if(names.some(x=>!x||x==='.'||x==='..'||/[\\:\x00-\x1f]/.test(x)))throw Error('Invalid directory label: '+value.slice(0,i));
  return [names,value.slice(i+1).trim()];
}
export function options(args){
  const {values:v}=parseArgs({args,options:{team:{type:'string',multiple:true},scope:{type:'string',multiple:true},out:{type:'string'},profile:{type:'string'},rescan:{type:'boolean'},'export-timeout-minutes':{type:'string'},'manual-start-captcha':{type:'boolean'},help:{type:'boolean',short:'h'}},allowPositionals:false});
  if(v.help)return {help:true};
  const rawTimeout=v['export-timeout-minutes']??String(defaultExportTimeoutMinutes);
  const minutes=Number(rawTimeout);
  if(!/^\d+$/.test(rawTimeout)||minutes<1||minutes>120)throw Error('--export-timeout-minutes must be a whole number from 1 to 120');
  const scopes=[];
  for(const item of v.team??[]){
    const [parts,value]=pair(item);
    const id=/^\d+$/.test(value)?value:browserListing(value)?.pathname.match(/\/team\/(\d+)(?:\/|$)/)?.[1];
    if(!id)throw Error('Invalid Figma team ID or URL');
    scopes.push({parts,url:`https://www.figma.com/files/team/${id}/all-folders`});
  }
  for(const item of v.scope??[]){
    const [parts,value]=pair(item), u=browserListing(value);
    if(!u)throw Error('Expected a Figma file-browser URL');
    scopes.push({parts,url:u.href});
  }
  if(!scopes.length)throw Error('Specify at least one --team or --scope. See --help.');
  const profileBase=process.platform==='darwin'?path.join(homedir(),'Library','Application Support'):path.join(homedir(),'.local','share');
  const launchDirectory=process.env.INIT_CWD || process.cwd();
  const root=path.resolve(launchDirectory,v.out??path.join(homedir(),'Downloads','Figma backup'));
  const profile=path.resolve(launchDirectory,v.profile??path.join(profileBase,'figma-export','chrome-profile'));
  const mainChrome=process.platform==='darwin'?path.join(homedir(),'Library','Application Support','Google','Chrome'):path.join(homedir(),'.config','google-chrome');
  const under=(a,b)=>a===b||a.startsWith(b+path.sep);
  if(under(profile,mainChrome)||under(root,profile)||under(profile,root))throw Error('Use a separate Chrome profile, outside the normal Chrome profile and archive directory.');
  return {scopes,root,profile,rescan:!!v.rescan,autoCaptcha:!v['manual-start-captcha'],downloadTimeout:minutes*60_000};
}
