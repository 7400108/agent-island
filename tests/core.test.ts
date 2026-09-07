import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, type Cursor } from '../electron/store.js';
import { CodexReader, consumeCodex } from '../electron/codex.js';
import { ClaudeHooks, mergeHooks } from '../electron/claude.js';

function fixture(t: any) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-island-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return {root,store:new Store(path.join(root,'data'),root)};
}
const stamp = () => new Date().toISOString();
const line = (type:string,payload:unknown) => JSON.stringify({timestamp:stamp(),type,payload})+'\n';
const meta = (source: any='cli') => line('session_meta',{id:'session-1',source,originator:'codex-tui',cwd:'C:\\project'});

test('Codex only emits a final answer, once; delete + restart cannot resurrect it', t=>{
  const {root,store}=fixture(t);
  const c:Cursor={offset:0,sessionId:'s',allowed:true,turnId:'',project:'project',lastAnswer:''};
  consumeCodex({type:'event_msg',payload:{type:'task_started',turn_id:'t'}},c,store);
  consumeCodex({type:'response_item',payload:{type:'message',role:'assistant',phase:'commentary',content:[{type:'output_text',text:'Working…'}]}},c,store);
  assert.equal(store.data.notifications.length,0);
  consumeCodex({type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:'答案 ✓'}]}},c,store);
  const event={type:'event_msg',payload:{type:'task_complete',turn_id:'t'}};
  consumeCodex(event,c,store);
  assert.equal(store.data.notifications[0].answer,'答案 ✓');
  assert.equal(store.data.tasks[0].status,'complete');
  store.clear();store.save();
  const restarted=new Store(path.join(root,'data'),root);
  consumeCodex({type:'event_msg',payload:{type:'task_complete',turn_id:'t',last_agent_message:'答案 ✓'}},c,restarted);
  assert.equal(restarted.data.notifications.length,0);
});
test('Codex tails baseline, buffers partial UTF-8 lines and resumes persisted offsets',async t=>{
  const {root,store}=fixture(t);
  const sessions=path.join(root,'sessions');fs.mkdirSync(sessions);
  const file=path.join(sessions,'rollout.jsonl');
  fs.writeFileSync(file,meta()+line('event_msg',{type:'task_complete',turn_id:'old',last_agent_message:'旧消息'}));
  store.data.settings.codex=true;store.data.settings.codexPath=sessions;
  const reader=new CodexReader(store);await reader.poll();assert.equal(store.data.notifications.length,0);
  fs.appendFileSync(file,line('event_msg',{type:'task_started',turn_id:'new'}));
  const complete=Buffer.from(line('event_msg',{type:'task_complete',turn_id:'new',last_agent_message:'中文完整回答🌱'}));
  const cut=complete.indexOf(Buffer.from('中'))+1;
  fs.appendFileSync(file,complete.subarray(0,cut));await reader.poll();assert.equal(store.data.notifications.length,0);
  store.save();const restarted=new Store(path.join(root,'data'),root);
  fs.appendFileSync(file,complete.subarray(cut));await new CodexReader(restarted).poll();
  assert.equal(restarted.data.notifications[0].answer,'中文完整回答🌱');
  await new CodexReader(restarted).poll();assert.equal(restarted.data.notifications.length,1);
});
test('Codex discovers new files, handles truncation, excludes child-agent sessions',async t=>{
  const {root,store}=fixture(t);const sessions=path.join(root,'sessions');fs.mkdirSync(sessions);
  store.data.settings.codex=true;store.data.settings.codexPath=sessions;const reader=new CodexReader(store);await reader.poll();
  const file=path.join(sessions,'new.jsonl');
  fs.writeFileSync(file,meta()+line('event_msg',{type:'task_started',turn_id:'a'})+line('event_msg',{type:'task_complete',turn_id:'a',last_agent_message:'first'}));
  fs.writeFileSync(path.join(sessions,'child.jsonl'),meta({subagent:{parent_thread_id:'parent'}})+line('event_msg',{type:'task_complete',turn_id:'child',last_agent_message:'child'}));
  await reader.poll();assert.equal(store.data.notifications.length,1);
  fs.writeFileSync(file,meta());await reader.poll();
  fs.appendFileSync(file,line('event_msg',{type:'task_complete',turn_id:'b',last_agent_message:'second'}));await reader.poll();
  assert.equal(store.data.notifications.length,2);
});
test('Parallel notifications persist until clear; timeout is not completion',t=>{
  const {store}=fixture(t);
  for(const source of ['codex','claude'] as const) {
    store.start({id:source,source,sessionId:source,turnId:'1',project:'',status:'running',updatedAt:stamp()});
    store.finish({id:source,source,sessionId:source,turnId:'1',project:'',answer:'answer',completedAt:stamp()});
  }
  assert.equal(store.data.notifications.length,2);
  assert.ok(store.data.notifications.every(n=>!('read' in n)));
  store.clear();assert.equal(store.data.notifications.length,0);
  assert.equal(Object.keys(store.data.seen).length,2);
  store.start({id:'stale',source:'codex',sessionId:'stale',turnId:'s',project:'',status:'running',updatedAt:'2000-01-01T00:00:00Z'});
  store.expire();assert.equal(store.data.tasks.find(t=>t.id==='stale')?.status,'uncertain');assert.equal(store.data.notifications.length,0);
});
test('Claude hook merge preserves other commands/settings and is reversible/idempotent',()=>{
  const original={permissions:{allow:['Read']},hooks:{Stop:[{matcher:'',hooks:[{type:'command',command:'echo original'}]}]}};
  const command='powershell.exe -File "C:/data/agent-island-bridge.ps1" -Inbox "C:/data/events"';
  const enabled=mergeHooks(original,command,true);
  assert.deepEqual(mergeHooks(enabled,command,true),enabled);
  assert.deepEqual(mergeHooks(enabled,command,false),original);
  assert.equal(original.hooks.Stop[0].hooks.length,1);
  assert.throws(()=>mergeHooks({hooks:{Stop:{bad:true}}},command,true));
});
test('Claude configuration backups and bridge install stay in selected fixture',t=>{
  const {root,store}=fixture(t);const config=path.join(root,'.claude');fs.mkdirSync(config);
  const original='{"permissions":{"allow":["Read"]}}';fs.writeFileSync(path.join(config,'settings.json'),original);
  const bridge=path.join(root,'bridge.ps1');fs.writeFileSync(bridge,'exit 0');
  const hooks=new ClaudeHooks(store,bridge);hooks.configure(true,config);
  assert.ok(fs.existsSync(hooks.bridge));assert.equal(fs.readdirSync(config).filter(n=>n.endsWith('.bak')).length,1);
  hooks.configure(false,config);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(config,'settings.json'),'utf8')),JSON.parse(original));
  fs.writeFileSync(path.join(config,'settings.json'),'{invalid');assert.throws(()=>hooks.configure(true,config));
  assert.equal(fs.readFileSync(path.join(config,'settings.json'),'utf8'),'{invalid');
});
test('Claude starts/stops, deduplicates Stop, ignores sidechain, and separates failures',t=>{
  const {store}=fixture(t);const hooks=new ClaudeHooks(store,'unused');
  const send=(name:string,id:string,extra={})=>hooks.consume({hook_event_name:name,event_id:id,session_id:'s',emitted_at:stamp(),cwd:'project',...extra});
  send('UserPromptSubmit','start');assert.equal(store.data.tasks[0].status,'running');
  send('Stop','child',{agent_id:'child',last_assistant_message:'hidden'});assert.equal(store.data.notifications.length,0);
  send('Stop','done',{last_assistant_message:'完整答案'});send('Stop','duplicate',{last_assistant_message:'完整答案'});
  assert.equal(store.data.notifications.length,1);assert.equal(store.data.notifications[0].answer,'完整答案');
  send('UserPromptSubmit','start2');send('StopFailure','fail',{error:'rate_limit'});
  assert.equal(store.data.tasks[0].status,'failed');assert.equal(store.data.notifications.length,1);
});
test('Interrupted tasks never become successful notifications',t=>{
  const {store}=fixture(t);const cursor:Cursor={offset:0,sessionId:'s',allowed:true,turnId:'',project:'',lastAnswer:''};
  consumeCodex({type:'event_msg',payload:{type:'task_started',turn_id:'turn'}},cursor,store);
  consumeCodex({type:'event_msg',payload:{type:'turn_aborted'}},cursor,store);
  assert.equal(store.data.tasks[0].status,'interrupted');assert.equal(store.data.notifications.length,0);
});
test('Codex exec sessions are accepted alongside interactive CLI',async t=>{
  const {root,store}=fixture(t);const sessions=path.join(root,'sessions');fs.mkdirSync(sessions);
  store.data.settings.codex=true;store.data.settings.codexPath=sessions;store.data.codexInitialized=true;
  fs.writeFileSync(path.join(sessions,'exec.jsonl'),line('session_meta',{id:'exec-session',source:'exec',originator:'codex_exec',thread_source:'user',cwd:root})+line('event_msg',{type:'task_started',turn_id:'exec-turn'})+line('event_msg',{type:'task_complete',turn_id:'exec-turn',last_agent_message:'AGENT_ISLAND_OK'}));
  await new CodexReader(store).poll();assert.equal(store.data.notifications[0].answer,'AGENT_ISLAND_OK');
});
test('Claude prompt_id tolerates delayed start delivery after completion',t=>{
  const {store}=fixture(t);const hooks=new ClaudeHooks(store,'unused');
  hooks.consume({hook_event_name:'Stop',event_id:'stop',session_id:'s',prompt_id:'p',emitted_at:stamp(),last_assistant_message:'done'});
  hooks.consume({hook_event_name:'UserPromptSubmit',event_id:'start-late',session_id:'s',prompt_id:'p',emitted_at:stamp()});
  assert.equal(store.data.notifications.length,1);assert.equal(store.data.tasks.filter(t=>t.status==='running').length,0);
  const config=mergeHooks({},'powershell -File agent-island-bridge.ps1 -Inbox test',true);
  assert.equal(config.hooks.Stop[0].hooks[0].async,false);
  assert.equal(config.hooks.UserPromptSubmit[0].hooks[0].async,true);
});

test('Legacy read and unread notifications both survive migration and restart', t=>{
  const {root,store}=fixture(t);
  const notifications=[true,false].map((read,i)=>({id:'legacy-'+i,source:'codex',sessionId:'legacy',turnId:String(i),project:'',answer:'保存的回答',completedAt:stamp(),read}));
  fs.mkdirSync(store.directory,{recursive:true});
  fs.writeFileSync(path.join(store.directory,'state.json'),JSON.stringify({...store.data,notifications}));
  const migrated=new Store(store.directory,root);
  assert.equal(migrated.data.notifications.length,2);
  assert.ok(migrated.data.notifications.every(n=>!('read' in n)));
  migrated.save();
  assert.equal(new Store(store.directory,root).data.notifications.length,2);
});
