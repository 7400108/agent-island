import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'output','playwright');fs.mkdirSync(output,{recursive:true});
const results=[];
for(const scale of [1,1.5,2]) {
  const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'agent-island-window-'));
  const env={...process.env,AGENT_ISLAND_TEST_DATA:fixture};delete env.ELECTRON_RUN_AS_NODE;
  let instance;
  try {
    instance=await electron.launch({args:[root,`--force-device-scale-factor=${scale}`],env,timeout:60000});
    const page=await instance.firstWindow();await page.waitForFunction(()=>Boolean(window.island));
    assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
    await instance.evaluate(({app})=>app.emit('second-instance'));
    await instance.evaluate(({BrowserWindow})=>{
      const w=BrowserWindow.getAllWindows()[0];
      const original=w.setIgnoreMouseEvents.bind(w);
      w.setIgnoreMouseEvents=(value,...args)=>{globalThis.testIgnoreMouse=value;original(value,...args);};
    });
    await page.getByRole('heading',{name:'通知中心',exact:true}).waitFor();
    await new Promise(resolve=>setTimeout(resolve,420));
    const layout=await page.evaluate(()=>{
      const panel=document.querySelector('.island').getBoundingClientRect();return {width:innerWidth,height:innerHeight,panel:{x:panel.x,y:panel.y,width:panel.width,height:panel.height},dpr:devicePixelRatio,overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert.equal(layout.overflow,false);assert.ok(layout.panel.x>=0);assert.ok(layout.panel.height<=layout.height);
    assert.equal(layout.panel.height,64);assert.equal(layout.panel.width,480);
    await page.screenshot({path:path.join(output,`scale-${scale}.png`)});
    await page.getByRole('button',{name:'收起',exact:true}).click();
    await page.waitForTimeout(500);
    assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
    await page.evaluate(()=>window.island.demo());
    await page.waitForFunction(()=>document.querySelectorAll('.capsule .wave i').length===12);
    assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true);
    const collapsed=await page.locator('.island').boundingBox();
    assert.equal(collapsed.width,120);assert.equal(collapsed.height,40);
    await page.mouse.move(2,5);
    assert.equal(await instance.evaluate(()=>globalThis.testIgnoreMouse),true);
    await page.mouse.move(120,20);
    assert.equal(await instance.evaluate(()=>globalThis.testIgnoreMouse),false);
    await page.mouse.move(21,1);
    assert.equal(await instance.evaluate(()=>globalThis.testIgnoreMouse),true);
    if(scale===1) {
      await instance.evaluate(({BrowserWindow})=>{
        const other=new BrowserWindow({width:180,height:120,x:40,y:250,show:true,title:'Agent Island focus test',webPreferences:{sandbox:true}});
        globalThis.focusProbe=other;
        other.focus();
      });
      await page.waitForFunction(()=>!document.querySelector('.island.expanded'));
      const deadline=Date.now()+10000;
      while(Date.now()<deadline && await page.evaluate(async()=> (await window.island.snapshot()).notifications.length)!==2) await page.waitForTimeout(100);
      assert.equal(await page.evaluate(async()=> (await window.island.snapshot()).notifications.length),2);
      assert.equal(await instance.evaluate(()=>globalThis.focusProbe.isFocused()),true);
      await instance.evaluate(()=>globalThis.focusProbe.destroy());
    }
    results.push({scale,layout,transparentMarginsAndCornersPassThrough:true});
  }finally {
    if(instance)await instance.close();
    if(path.dirname(fixture)===os.tmpdir()&&path.basename(fixture).startsWith('agent-island-window-'))fs.rmSync(fixture,{recursive:true,force:true});
  }
}
fs.writeFileSync(path.join(output,'window-results.json'),JSON.stringify({passed:true,results,notificationDoesNotStealFocus:true},null,2));
console.log(JSON.stringify({passed:true,scales:results.map(r=>r.scale),transparentHitTesting:true,notificationDoesNotStealFocus:true}));
