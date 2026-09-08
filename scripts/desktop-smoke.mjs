import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Store } from '../dist-electron/electron/store.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'output','playwright');fs.mkdirSync(output,{recursive:true});
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'agent-island-desktop-'));
const data=path.join(fixture,'data');
const sessions=path.join(fixture,'sessions');fs.mkdirSync(sessions);
const claude=path.join(fixture,'claude');fs.mkdirSync(claude);
fs.writeFileSync(path.join(claude,'settings.json'),JSON.stringify({permissions:{allow:['Read']}}));
const store=new Store(data,fixture);store.data.settings.codexPath=sessions;store.data.settings.claudePath=claude;store.save();
const env={...process.env,AGENT_ISLAND_TEST_DATA:data};delete env.ELECTRON_RUN_AS_NODE;
const launchOptions={args:process.env.AGENT_ISLAND_EXECUTABLE?[]:[root],executablePath:process.env.AGENT_ISLAND_EXECUTABLE||undefined,env,timeout:60000};
let instance;
const faults=[];
const results=[];
// Await asynchronous IPC predicates explicitly; hidden windows do not produce animation frames.
async function waitForCondition(page, fn, arg, options={}) {
  const deadline=Date.now()+(options.timeout ?? 15000);
  while(Date.now()<deadline) {
    if(await page.evaluate(fn,arg)) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`Condition timed out: ${fn.toString()}`);
}
async function runBridge(event) {
  await new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(data,'agent-island-bridge.ps1'),'-Inbox',path.join(data,'events')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
    child.on('error',reject);child.on('exit',code=>{try{assert.equal(code,0);assert.equal(stdout,'');assert.equal(stderr,'');resolve();}catch(e){reject(e);}});
    child.stdin.end(JSON.stringify(event));
  });
}
try {
  instance=await electron.launch(launchOptions);
  const page=await instance.firstWindow();page.on('pageerror',e=>faults.push(e.message));
  page.setDefaultTimeout(15000);
  page.waitForFunction=(...args)=>waitForCondition(page,...args);
  await page.waitForFunction(()=>Boolean(window.island));
  assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
  await instance.evaluate(({app})=>app.emit('second-instance'));
  await page.getByRole('heading',{name:'通知中心',exact:true}).waitFor();
  await page.screenshot({path:path.join(output,'01-empty.png')});
  await page.getByRole('button',{name:'打开设置',exact:true}).click();
  await page.getByRole('checkbox',{name:'开启 Codex',exact:true}).click();
  await page.waitForFunction(async()=> (await window.island.snapshot()).health.codex.state==='ready');
  await page.getByRole('checkbox',{name:'开启 Claude Code',exact:true}).click();
  await page.waitForFunction(async()=> (await window.island.snapshot()).health.claude.state==='ready');
  await page.screenshot({path:path.join(output,'02-settings.png')});
  results.push('Settings enable both providers in isolated directories; existing Claude permissions preserved.');
  const file=path.join(sessions,'rollout-smoke.jsonl');
  const line=(type,payload)=>JSON.stringify({timestamp:new Date().toISOString(),type,payload})+'\n';
  fs.writeFileSync(file,line('session_meta',{id:'smoke-codex',source:'cli',cwd:'C:/projects/agent-island'})+line('event_msg',{type:'task_started',turn_id:'smoke-turn'}));
  await runBridge({hook_event_name:'UserPromptSubmit',session_id:'smoke-claude',cwd:'C:/projects/agent-island'});
  await page.waitForFunction(async()=> (await window.island.snapshot()).tasks.filter(t=>t.status==='running').length===2);
  await page.getByRole('button',{name:'返回通知列表',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.live-task').length===2);
  await page.screenshot({path:path.join(output,'03-running.png')});
  await page.getByRole('button',{name:'收起',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.island.expanded'));
  await new Promise(resolve=>setTimeout(resolve,500));
  await page.screenshot({path:path.join(output,'04-capsule.png')});
  const waveSamples = await page.locator('.capsule .wave i').evaluateAll(bars => bars.map(b => b.getBoundingClientRect().height));
  assert.equal(waveSamples.length,12);
  assert.ok(Math.max(...waveSamples)-Math.min(...waveSamples)>8,'wave has visibly different peaks');
  await page.waitForTimeout(180);
  const nextWave = await page.locator('.capsule .wave i').evaluateAll(bars => bars.map(b => b.getBoundingClientRect().height));
  assert.ok(nextWave.some((h,i)=>Math.abs(h-waveSamples[i])>2),'wave animates over time');
  const nativeState=await instance.evaluate(({BrowserWindow,screen})=>{
    const w=BrowserWindow.getAllWindows()[0];return {topmost:w.isAlwaysOnTop(),bounds:w.getBounds(),display:screen.getPrimaryDisplay().workArea,focused:w.isFocused()};
  });
  assert.equal(nativeState.topmost,true);
  assert.ok(Math.abs(nativeState.bounds.x+nativeState.bounds.width/2-(nativeState.display.x+nativeState.display.width/2))<2);
  results.push('Native window is always-on-top and centered on primary display.');
  await instance.evaluate(async ({BrowserWindow})=>{
    const probe=new BrowserWindow({width:240,height:120,x:40,y:700,show:false});
    probe.setTitle('Agent Island isolated focus probe');
    await probe.loadURL('data:text/html,Notification focus test');
    probe.show();probe.focus();
  });
  fs.appendFileSync(file,line('event_msg',{type:'task_complete',turn_id:'smoke-turn',last_agent_message:'## 已完成界面优化\n\n灵动岛已经准备就绪。保持专注，让进度自己来找你。\n\n- 支持 **Codex CLI** 与 **Claude Code**\n- 回答完成后自动汇集到通知中心\n\n```typescript\nconst island = { status: "ready", count: 2 };\n```\n\n[官方文档](https://developers.openai.com/)\n\n<script>window.injected=true</script>\n\n![external](https://example.invalid/tracking.png)'}));
  await runBridge({hook_event_name:'Stop',session_id:'smoke-claude',cwd:'C:/projects/agent-island',last_assistant_message:'## 检查已通过\n\n两个并行会话已完成。中文回答可以正确显示，通知保存在本机。'});
  await page.waitForFunction(async()=> (await window.island.snapshot()).notifications.length===2);
  await page.waitForFunction(()=>document.querySelector('.island')?.dataset.mode==='peek');
  const appeared=Date.now();
  await page.getByRole('heading',{name:'已完成界面优化'}).waitFor();
  await page.getByRole('heading',{name:'检查已通过'}).waitFor();
  assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Agent Island isolated focus probe').isFocused()),true);
  await page.screenshot({path:path.join(output,'05-auto-popup.png')});
  await page.waitForTimeout(850);
  assert.equal(await page.locator('.island').getAttribute('data-mode'),'peek');
  await page.waitForFunction(()=>document.querySelector('.island')?.dataset.mode==='closed',{},{timeout:2600});
  const peekDuration=Date.now()-appeared;
  assert.ok(peekDuration>=1500 && peekDuration<3000,`auto-peek duration ${peekDuration}`);
  await page.waitForTimeout(450);
  assert.equal(await page.locator('.compact-count').innerText(),'2');
  await page.getByRole('button',{name:/展开灵动岛/}).click();
  await page.getByText('2 条通知', {exact:true}).waitFor();
  await page.getByRole('heading',{name:'已完成界面优化'}).waitFor();
  assert.equal(await page.locator('.notification-open,.card-delete,.unread-dot,.confirm-dialog,.tabs').count(),0);
  assert.equal(await page.evaluate(()=>window.injected),undefined);
  assert.equal(await page.locator('.answer img').count(),0);
  assert.equal(await page.locator('.answer pre code').count(),1);
  await page.waitForTimeout(450);
  await page.screenshot({path:path.join(output,'06-inline-answers.png')});
  await page.waitForTimeout(2300);
  assert.equal(await page.locator('.island').getAttribute('data-mode'),'manual');
  assert.equal(await page.evaluate(async()=> (await window.island.snapshot()).notifications.length),2);
  assert.ok(await page.evaluate(async()=> (await window.island.snapshot()).notifications.every(n=>!('read' in n))));
  await page.getByRole('button',{name:'复制 Codex 回答',exact:true}).click();
  await page.getByRole('status').filter({hasText:'答案已复制'}).waitFor();
  const copied=await instance.evaluate(({clipboard})=>clipboard.readText());assert.ok(copied.startsWith('## 已完成界面优化'));
  await page.getByRole('button',{name:'清空全部通知',exact:true}).click();
  await page.waitForFunction(async()=> (await window.island.snapshot()).notifications.length===0);
  assert.equal(await page.locator('.confirm-dialog').count(),0);
  fs.appendFileSync(file,line('event_msg',{type:'task_complete',turn_id:'smoke-turn',last_agent_message:'同一回答不应复活'}));
  await page.waitForTimeout(2300);
  assert.equal(await page.evaluate(async()=> (await window.island.snapshot()).notifications.length),0);
  results.push('12 animated low/high bars; automatic popup ~2 seconds without focus theft; inline Markdown/code; count unchanged after viewing; copy and direct clear-all; no per-item delete or confirmation.');

  // Interacting with an automatic popup keeps it open for reading.
  assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:')).isVisible()),false);
  await page.waitForTimeout(450);
  fs.appendFileSync(file,line('event_msg',{type:'task_started',turn_id:'takeover'})+line('event_msg',{type:'task_complete',turn_id:'takeover',last_agent_message:'手动阅读时不要自动收起'}));
  await page.waitForFunction(()=>document.querySelector('.island')?.dataset.mode==='peek');
  await page.getByText('手动阅读时不要自动收起',{exact:true}).click();
  await page.waitForTimeout(2400);
  assert.equal(await page.locator('.island').getAttribute('data-mode'),'manual');
  // An incoming answer must not close or replace settings the user is editing.
  await page.getByRole('button',{name:'打开设置',exact:true}).click();
  fs.appendFileSync(file,line('event_msg',{type:'task_started',turn_id:'settings-arrival'})+line('event_msg',{type:'task_complete',turn_id:'settings-arrival',last_agent_message:'保留设置页面'}));
  await page.waitForFunction(async()=> (await window.island.snapshot()).notifications.length===2);
  await page.waitForTimeout(2300);
  await page.getByRole('heading',{name:'偏好设置',exact:true}).waitFor();
  await page.getByRole('button',{name:'返回通知列表',exact:true}).click();
  await page.getByRole('button',{name:'清空全部通知',exact:true}).click();
  await page.waitForFunction(async()=> (await window.island.snapshot()).notifications.length===0);
  results.push('Clicking an automatic popup cancels auto-close; a new answer does not interrupt manual settings.');
  fs.appendFileSync(file,line('event_msg',{type:'task_started',turn_id:'running-clear'}));
  await page.waitForFunction(()=>document.querySelectorAll('.capsule .wave i').length===12);
  await page.evaluate(()=>window.island.clearNotifications());
  assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:')).isVisible()),true);
  fs.appendFileSync(file,line('event_msg',{type:'turn_aborted',turn_id:'running-clear'}));
  await page.waitForFunction(async()=>!(await window.island.snapshot()).tasks.some(t=>t.status==='running'));
  await page.waitForTimeout(200);
  assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:')).isVisible()),false);
  results.push('Idle startup/restart hidden; task start reveals island; clear during running stays visible; interruption without notifications hides it.');
  await instance.close();instance=undefined;
  instance=await electron.launch(launchOptions);
  const restarted=await instance.firstWindow();
  restarted.setDefaultTimeout(15000);
  restarted.waitForFunction=(...args)=>waitForCondition(restarted,...args);
  await restarted.waitForFunction(()=>Boolean(window.island));
  await new Promise(resolve=>setTimeout(resolve,2500));
  assert.equal(await restarted.evaluate(async()=> (await window.island.snapshot()).notifications.length),0);
  assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
  await instance.evaluate(({app})=>app.emit('second-instance'));
  await restarted.getByRole('button',{name:'打开设置',exact:true}).click();
  await restarted.getByRole('checkbox',{name:'开启 Claude Code',exact:true}).click();
  await restarted.waitForFunction(async()=> !(await window.island.snapshot()).settings.claude);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(claude,'settings.json'),'utf8')),{permissions:{allow:['Read']}});
  results.push('Restart does not resurrect deleted notifications; disabling Claude removes only our hooks.');
  assert.deepEqual(faults,[]);
  fs.writeFileSync(path.join(output,'desktop-results.json'),JSON.stringify({passed:true,results,nativeState,rendererErrors:faults},null,2));
  console.log(JSON.stringify({passed:true,results},null,2));
} catch (error) {
  if (instance) {
    const page=await instance.firstWindow();
    await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
    console.error((await page.locator('body').innerText()).slice(0,2200));
  }
  throw error;
} finally {
  if(instance) await instance.close();
  // This exact mkdtemp fixture is owned by this smoke test, not the user's data.
  if(path.dirname(fixture)===os.tmpdir()&&path.basename(fixture).startsWith('agent-island-desktop-'))fs.rmSync(fixture,{recursive:true,force:true});
}
