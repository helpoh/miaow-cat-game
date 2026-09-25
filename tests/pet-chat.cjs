// Run: NODE_PATH=<bundled node_modules> node tests/pet-chat.cjs
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..'), out=path.join(root,'.qa');
const files=new Set(['index.html','style.css','game.js','pet.js','online.js','local-model.js']);
const server=http.createServer((req,res)=>{
  const file=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
  if(!files.has(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');
  res.end(fs.readFileSync(path.join(root,file)));
});
let browser;
const errors=[];
// Protocol fixture: these tests verify UI/lifecycle and action guards, NOT model quality.
const workerFixture=`
self.onmessage=({data:m})=>{
 const send=(type,fields={})=>self.postMessage({id:m.id,type,...fields});
 if(m.type==='load'){send('progress',{progress:.3,text:'测试加载进度'});setTimeout(()=>send('ready'),40);}
 if(m.type==='clear'){setTimeout(()=>send('cleared'),40);}
 if(m.type==='generate'){
   const input=m.messages.at(-1).content;
   if(input==='测试失败'){setTimeout(()=>send('error',{text:'测试中的设备内存不足'}),40);return;}
   if(input==='测试超时')return;
   setTimeout(()=>send('token',{text:'测试模型：'}),30);
   setTimeout(()=>send('done',{text:'测试模型：'+input}),input==='慢回复'?1500:100);
 }
};`;

async function run(){
  fs.mkdirSync(out,{recursive:true});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-backgrounding-occluded-windows']});
  const context=await browser.newContext({viewport:{width:1280,height:900},hasTouch:true});
  await context.addInitScript(()=>{Object.defineProperty(navigator,'gpu',{configurable:true,value:{}});});
  await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  await context.route('**/local-model-worker.js*',r=>r.fulfill({contentType:'text/javascript',body:workerFixture}));
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  const mode=()=>page.locator('#petScene').getAttribute('data-action');
  const last=()=>page.locator('#petMessage').textContent();
  const chatLast=()=>page.locator('.pet-chat-bubble.cat').last().textContent();
  const count=()=>page.locator('.pet-chat-bubble').count();
  const ready=()=>page.waitForFunction(()=>!document.querySelector('#petChatSend').disabled);
  const load=async()=>{await page.locator('#petModelLoad').click();await ready();};
  const send=async text=>{await page.locator('#petChatInput').fill(text);await page.locator('#petChatInput').press('Enter');await ready();};
  const state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('catyard-pet-v1')));
  async function boot(seed,chat){
    await page.goto(base);
    if(seed!==undefined){await page.evaluate(({seed,chat})=>{
      localStorage.setItem('catyard-pet-v1',JSON.stringify({born:Date.now(),lastSeen:Date.now(),bond:62,energy:78,food:68,weight:100,x:320,scene:'room',...seed}));
      localStorage.setItem('catyard-pet-chat-v1',JSON.stringify(chat||[]));
    },{seed,chat});await page.reload();}
    await page.locator('#petOpen').click();await load();
  }
  await boot({});
  await send('你好');assert.match(await chatLast(),/你好/);assert.equal(await mode(),'idle');
  const n=await count();await send('   ');assert.equal(await count(),n);
  await page.locator('[data-chat="摸摸你"]').click();await ready();assert.equal(await mode(),'pet');
  const bond=(await state()).bond;await send('摸摸你');assert.equal((await state()).bond,bond);
  await send('吃饭啦');assert.equal(await mode(),'eat');assert(Math.abs((await state()).food-88)<.2);
  const weight=(await state()).weight;
  await send('一起玩');assert.equal(await mode(),'eat');assert.match(await last(),/正在吃饭/);assert.equal((await state()).weight,weight);
  await page.waitForFunction(()=>document.querySelector('#petScene').dataset.action==='idle',{},{timeout:10000});
  await send('一起玩');assert.equal(await mode(),'play');assert.equal((await state()).energy<71,true);
  await send('睡觉吧');assert.equal(await mode(),'play');assert.match(await last(),/追毛线球/);
  await page.waitForFunction(()=>document.querySelector('#petScene').dataset.action==='idle',{},{timeout:10000});
  await send('睡觉吧');assert.equal(await mode(),'sleep');
  await send('睡觉吧');assert.equal(await mode(),'sleep');assert.match(await last(),/已经睡着/);
  await send('查看状态');assert.match(await chatLast(),/查看状态/);assert.equal(await mode(),'sleep');
  await send('叫醒');assert.equal(await mode(),'idle');
  await send('叫醒');assert.match(await last(),/已经醒着/);
  for(const text of ['别摸我','不要吃饭','不想玩','不睡觉','先不休息','别睡觉，摸摸你','不需要喂食','没让你吃饭']){
    await send(text);assert.equal(await mode(),'idle');assert.match(await chatLast(),new RegExp(text));
  }
  await send('饿不饿');assert.match(await chatLast(),/饿不饿/);assert.equal(await mode(),'idle');
  await send('摸摸你然后吃饭');assert.equal(await mode(),'pet');assert.match(await chatLast(),/摸摸你然后吃饭/);
  await send('计算一千乘五');assert.match(await chatLast(),/计算一千乘五/);
  await send('<img src=x onerror=alert(1)>');assert.equal(await page.locator('#petChatLog img').count(),0);
  // Sleep button still toggles; chat sleeping is idempotent.
  await page.locator('[data-pet-action="sleep"]').click();assert.equal(await mode(),'sleep');
  await page.locator('[data-pet-action="sleep"]').click();assert.equal(await mode(),'idle');
  // IME candidate selection and immediate submission must not send.
  const input=page.locator('#petChatInput');await input.fill('摸摸你');const beforeIME=await count();
  await input.dispatchEvent('compositionstart');
  await input.dispatchEvent('keydown',{key:'Enter',isComposing:true,keyCode:229});
  await page.locator('#petChatForm').dispatchEvent('submit');assert.equal(await count(),beforeIME);
  await input.dispatchEvent('compositionend');await page.waitForTimeout(100);await input.press('Enter');await ready();assert.equal(await mode(),'pet');
  await boot({food:99});await send('吃饭啦');assert.match(await last(),/饱饱/);assert.equal(await mode(),'idle');
  await boot({energy:5});await send('一起玩');assert.match(await last(),/困了/);assert.equal(await mode(),'idle');
  await boot({});
  // Real touch drag, with a second UI input while the first pointer is held.
  await page.locator('#petScene').scrollIntoViewIfNeeded();
  const box=await page.locator('#petScene').boundingBox(),px=box.x+box.width/2,py=box.y+box.height*250/390;
  const cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:px,y:py}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:px+40,y:py-60}]});
  assert.equal(await mode(),'held');
  await page.locator('[data-chat="吃饭啦"]').evaluate(b=>b.click());assert.match(await last(),/放稳/);assert.equal(await mode(),'held');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForFunction(()=>document.querySelector('#petScene').dataset.action==='idle',{},{timeout:5000});
  // Keep exactly 30 messages; refresh and clear are independent of pet progress.
  for(let i=0;i<17;i++)await send('你好 '+i);
  assert.equal(await count(),30);await page.reload();await page.locator('#petOpen').click();await load();assert.equal(await count(),30);
  await send('摸摸你');const petBefore=await state();
  await page.locator('#petChatClear').click();assert.equal(await count(),0);assert.deepEqual(await state(),petBefore);
  await page.reload();await page.locator('#petOpen').click();await load();assert.equal(await count(),0);
  await input.fill('哈'.repeat(201));assert.equal((await input.inputValue()).length,200);
  await input.evaluate(el=>{el.value='哈'.repeat(201);});await input.press('Enter');assert.equal(await count(),0);assert.match(await page.locator('#petChatNotice').textContent(),/200/);
  // Input is reachable in the focus loop, Escape returns focus to the opener.
  await input.focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.type),'submit');
  await page.locator('#petReset').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'petClose');
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'petOpen');
  await page.locator('#petOpen').click();await load();
  await send('你好');
  for(const [name,width,height] of [['desktop',1280,900],['landscape',844,390],['portrait',390,844],['keyboard',390,410]]){
    await page.setViewportSize({width,height});await input.focus();await page.waitForTimeout(120);
    const layout=await page.evaluate(()=>{
      const input=document.querySelector('#petChatInput').getBoundingClientRect();const modal=document.querySelector('.pet-device').getBoundingClientRect();
      return {inputBottom:input.bottom,inputTop:input.top,inputRight:input.right,modalRight:modal.right,scrollWidth:document.querySelector('.pet-main').scrollWidth,clientWidth:document.querySelector('.pet-main').clientWidth,height:visualViewport.height,width:visualViewport.width};
    });
    assert(layout.inputBottom<=layout.height+1,JSON.stringify(layout));assert(layout.inputTop>=0,JSON.stringify(layout));
    assert(layout.inputRight<=layout.width&&layout.modalRight<=layout.width,JSON.stringify(layout));assert(layout.scrollWidth<=layout.clientWidth+1,JSON.stringify(layout));
    await page.screenshot({path:path.join(out,`chat-${name}.png`)});
  }
  // Streaming cancellation and stale results cannot resurrect cleared chat.
  await send('你好');
  await input.fill('慢回复');await input.press('Enter');
  await page.waitForFunction(()=>document.querySelector('#petChatForm').getAttribute('aria-busy')==='true');
  assert(await page.locator('#petChatSend').isDisabled());
  await page.locator('#petChatClear').click();assert.equal(await count(),0);
  await page.waitForTimeout(1700);assert.equal(await count(),0);
  await load();await input.fill('慢回复');await input.press('Enter');
  await page.locator('#petModelStop').click();await page.waitForTimeout(1700);
  assert(await page.locator('#petChatSend').isDisabled());
  await load();await input.fill('测试失败');await input.press('Enter');
  await page.waitForFunction(()=>document.querySelector('#petModelStatus').textContent.includes('内存不足'));
  assert(await page.locator('#petChatSend').isDisabled());
  await page.locator('#petModelCache').click();
  await page.waitForFunction(()=>document.querySelector('#petModelStatus').textContent.includes('缓存已清除'));
  await load();await input.fill('慢回复');await input.press('Enter');await page.locator('#petClose').click();
  await page.waitForTimeout(1700);await page.locator('#petOpen').click();assert(await page.locator('#petChatSend').isDisabled());
  await load();
  // Disabled storage must not prevent sending or clearing.
  await page.addInitScript(()=>{Storage.prototype.getItem=()=>{throw Error('blocked')};Storage.prototype.setItem=()=>{throw Error('blocked')};});
  await page.reload();await page.locator('#petOpen').click();await load();await send('吃饭啦');assert.equal(await mode(),'eat');assert.match(await page.locator('#petChatNotice').textContent(),/无法保存/);
  await page.locator('#petChatClear').click();assert.equal(await count(),0);
  // Unsupported browser: no fabricated chat or automatic cloud fallback.
  await page.addInitScript(()=>{Object.defineProperty(navigator,'gpu',{configurable:true,value:undefined});});
  await page.reload();await page.locator('#petOpen').click();await page.locator('#petModelLoad').click();
  assert.match(await page.locator('#petModelStatus').textContent(),/不支持/);assert(await page.locator('#petChatSend').isDisabled());
  await page.locator('[data-pet-action="pet"]').click();assert.equal(await mode(),'pet');
  assert.deepEqual(errors,[]);
  console.log('PASS (protocol fixture): local-model lifecycle, guarded actions, touch, sleep/wake, IME, length, safe text, history, focus, 4 layouts, blocked storage, unsupported GPU.');
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
