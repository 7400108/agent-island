// Optional integration check: makes one tiny authenticated request per installed CLI.
// All hook settings and app state use a disposable test directory, never global configuration.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Store } from '../dist-electron/electron/store.js';
import { CodexReader } from '../dist-electron/electron/codex.js';
import { ClaudeHooks } from '../dist-electron/electron/claude.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'agent-island-live-'));
const output=path.join(root,'output','playwright');fs.mkdirSync(output,{recursive:true});
const store=new Store(path.join(fixture,'data'),os.homedir());
const cliSettings=path.join(fixture,'claude');fs.mkdirSync(cliSettings);
store.data.settings.claudePath=cliSettings;
store.data.settings.claude=true;
store.data.claudeEnabledAt=new Date().toISOString();
const hooks=new ClaudeHooks(store,path.join(root,'resources','agent-island-bridge.ps1'));
hooks.configure(true);
if(process.env.AGENT_ISLAND_DIAGNOSE_HOOKS) {
  const configFile=path.join(cliSettings,'settings.json');
  const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
  const diagScript=path.join(root,'scripts','hook-diagnostic.ps1').replaceAll('\\','/');
  const diagInbox=hooks.inbox.replaceAll('\\','/');
  config.hooks.Stop.push({hooks:[{type:'command',command:`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${diagScript}" -Inbox "${diagInbox}"`,timeout:3}]});
  fs.writeFileSync(configFile,JSON.stringify(config));
}
const report={};
const codexEntry=process.env.AGENT_ISLAND_CODEX_ENTRY||'D:/npm/global/node_modules/@openai/codex/bin/codex.js';
const claudeExe=process.env.AGENT_ISLAND_CLAUDE_EXE||'D:/npm/global/node_modules/@anthropic-ai/claude-code/bin/claude.exe';
function run(exe,args,env=process.env) {
  return new Promise(resolve=>{
    const child=spawn(exe,args,{cwd:fixture,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout.on('data',b=>{stdout=(stdout+b).slice(-500_000);});
    child.stderr.on('data',b=>{stderr=(stderr+b).slice(-500_000);});
    const timeout=setTimeout(()=>{
      if(process.platform==='win32'&&child.pid)spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
      else child.kill();
    },90_000);
    child.on('error',()=>{clearTimeout(timeout);resolve({code:-1,stdout:'',stderr:'not installed'});});
    child.on('exit',code=>{clearTimeout(timeout);resolve({code,stdout,stderr});});
  });
}
async function walk(dir) {
  const result=[];
  for(const e of await fs.promises.readdir(dir,{withFileTypes:true}).catch(()=>[])) {
    const file=path.join(dir,e.name);
    if(e.isDirectory()) result.push(...await walk(file));
    else if(e.name.endsWith('.jsonl')) result.push(file);
  }
  return result;
}
try {
  const before=Date.now();
  if(!process.env.AGENT_ISLAND_SKIP_CODEX) {
  const outcome=await run(process.execPath,[codexEntry,'exec','--skip-git-repo-check','--sandbox','read-only','--json','-c','model_reasoning_effort="low"','Reply with exactly AGENT_ISLAND_OK. Do not call any tools or read any files.']);
  const candidates=await walk(store.data.settings.codexPath);
  let sample;
  for(const file of candidates) {
    if(fs.statSync(file).mtimeMs<before)continue;
    const first=fs.readFileSync(file,'utf8').split('\n')[0];
    try { const m=JSON.parse(first).payload;if(path.resolve(m.cwd||'')===path.resolve(fixture)) { sample=file;report.codexMetadata={source:m.source,originator:m.originator,version:m.cli_version};break; } }catch{}
  }
  if(sample) {
    const mirror=path.join(fixture,'codex-sessions');fs.mkdirSync(mirror);fs.copyFileSync(sample,path.join(mirror,'smoke.jsonl'));
    store.data.settings.codexPath=mirror;store.data.settings.codex=true;store.data.codexInitialized=true;
    await new CodexReader(store).poll();
  }
  report.codex={exitCode:outcome.code,cliAnswered:outcome.stdout.includes('AGENT_ISLAND_OK'),notificationReceived:store.data.notifications.some(n=>n.source==='codex'&&n.answer.includes('AGENT_ISLAND_OK'))};
  console.log('Codex integration:',JSON.stringify(report.codex));
  }
  // Preserve configured provider credentials only in process memory; do not persist or log them.
  const userSettings=path.join(process.env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude'),'settings.json');
  let providerEnv={},modelArgs=[];
  try { const config=JSON.parse(fs.readFileSync(userSettings,'utf8'));for(const [key,value] of Object.entries(config.env||{})) if(key.startsWith('ANTHROPIC_')||key.startsWith('CLAUDE_CODE_USE_'))providerEnv[key]=String(value);if(typeof config.model==='string')modelArgs=['--model',config.model]; }catch{}
  const claudeResult=await run(claudeExe,['-p','Reply with exactly AGENT_ISLAND_OK.','--output-format','json','--tools','','--setting-sources','','--settings',path.join(cliSettings,'settings.json'),'--strict-mcp-config','--disable-slash-commands',...modelArgs],{...process.env,...providerEnv});
  await new Promise(resolve=>setTimeout(resolve,2000));
  const hookNames=[],hookErrors=[];
  if(process.env.AGENT_ISLAND_DIAGNOSE_HOOKS) {
    report.claudeHookShapes=fs.readdirSync(hooks.inbox).filter(n=>n.endsWith('.shape')).map(n=>JSON.parse(fs.readFileSync(path.join(hooks.inbox,n),'utf8')));
    console.log('Hook shapes:',JSON.stringify(report.claudeHookShapes));
  }
  for(const file of fs.readdirSync(hooks.inbox)) {
    if(!file.endsWith('.json'))continue;
    try {const event=JSON.parse(fs.readFileSync(path.join(hooks.inbox,file),'utf8'));hookNames.push(event.hook_event_name);if(event.error)hookErrors.push(event.error);}catch{}
  }
  hooks.poll();
  report.claude={exitCode:claudeResult.code,cliAnswered:claudeResult.stdout.includes('AGENT_ISLAND_OK'),notificationReceived:store.data.notifications.some(n=>n.source==='claude'&&n.answer.includes('AGENT_ISLAND_OK')),hookEvents:Object.keys(store.data.seen).filter(k=>k.startsWith('claude-event:')).length};
  report.claude.hookNames=hookNames;report.claude.hookErrors=hookErrors;
  report.claude.httpStatus=(claudeResult.stdout+claudeResult.stderr).match(/(?:API Error:|status[ :=]+|HTTP[ /][\d.]*\s)(\d{3})/i)?.[1];
  console.log('Claude integration:',JSON.stringify(report.claude));
  if(!report.claude.cliAnswered) report.claude.failureCategory=/auth|login|log in|401|credential|api.?key/i.test(claudeResult.stdout+claudeResult.stderr)?'authentication unavailable':claudeResult.code===null?'timeout':'CLI did not complete';
  fs.writeFileSync(path.join(output,'live-cli-results.json'),JSON.stringify(report,null,2));
} finally {
  if(path.dirname(fixture)===os.tmpdir()&&path.basename(fixture).startsWith('agent-island-live-'))fs.rmSync(fixture,{recursive:true,force:true});
}
