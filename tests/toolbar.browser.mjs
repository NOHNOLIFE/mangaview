// 左侧工具面板：左缘悬停弹出、离开收起、设置项与布局。框架同 tests/browser.mjs。
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const binary=process.argv[2];if(!binary)throw Error('Usage: node tests/toolbar.browser.mjs <chrome-or-edge-executable>');
const profile=await mkdtemp(join(process.env.MV_TEST_TEMP||tmpdir(),'mv-toolbar-'));
const mime={mjs:'text/javascript',js:'text/javascript',html:'text/html',webmanifest:'application/manifest+json',png:'image/png',css:'text/css'};
const server=createServer(async(req,res)=>{try{
  const path=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
  if(!/^(?:icons\/)?[\w.-]+$/.test(path))throw Error();
  let data=await readFile(new URL('../'+path,import.meta.url));
  res.writeHead(200,{'Content-Type':mime[path.split('.').pop()],'Cache-Control':'no-cache'});res.end(data);
}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port+'/';
const chrome=spawn(binary,['--headless=new','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--disable-background-networking','--window-size=800,900','about:blank'],{stdio:'ignore'});
let ws,id=0,cdp;const pending=new Map(),errors=[];
async function wait(check){let last;for(let i=0;i<150;i++){try{last=await check();if(last)return last;}catch(e){last=e;}await delay(75);}throw Error('Timed out: '+check+'; last: '+last);}
try{
  const port=await wait(async()=>(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);
  const target=(await (await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page');
  async function attach(page){
    ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
    ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(Error(m.error.message));else p.resolve(m.result);}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
  }
  await attach(target);
  cdp=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const js=async expression=>{const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  await cdp('Runtime.enable');await cdp('Page.enable');await cdp('Network.enable');
  await cdp('Page.navigate',{url:origin});await wait(()=>js('document.querySelector("#empty")?.hidden===false'));
  await js(`(async()=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('Toolbar book',{create:true});
    for(let i=0;i<12;i++){const out=await (await dir.getFileHandle(i+'.svg',{create:true})).createWritable();await out.write('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="100%" height="100%" fill="teal"/></svg>');await out.close();}
    window.showDirectoryPicker=async()=>dir;document.querySelector('#empty [data-act="folder"]').click();})()`);
  await wait(()=>js(`bookTitle.textContent==='Toolbar book'&&!!document.querySelector('#reader [data-name="0.svg"] img')`));
  const height=await js('innerHeight'),move=(x,y=height/2)=>cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
  const geometry=()=>js('JSON.stringify([reader.getBoundingClientRect(),reader.clientWidth,reader.scrollTop])');
  const box=sel=>js(`(()=>{const r=document.querySelector('${sel}').getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};})()`);
  // 左缘悬停约 120ms 弹出；面板浮在正文上，不改变阅读区几何。
  await js('reader.scrollTop=400');await delay(100);const before=await geometry();
  assert.equal(await js('bar.hidden'),true);
  await move(400);await move(2);await delay(40);assert.equal(await js('bar.hidden'),true,'Edge needs a short dwell');
  await wait(()=>js('!bar.hidden&&document.getElementById("toolbar").classList.contains("open")&&tab.getAttribute("aria-expanded")==="true"'));
  await js('Promise.all(bar.getAnimations().map(a=>a.finished)).then(()=>true)');
  assert.equal(await geometry(),before,'Panel overlays the reader without resizing it');
  const panel=await box('#bar');assert.equal(panel.left,0);assert.equal(panel.top,0);assert.ok(Math.abs(panel.width-260)<=2,'Two-column panel is about 260px wide: '+panel.width);
  assert.ok(panel.bottom<=height+1);
  // 顶部标题行横跨整个面板；书架按钮横跨整行。
  const heading=await box('#bar .heading'),inner=await js('bar.clientWidth-parseFloat(getComputedStyle(bar).paddingLeft)-parseFloat(getComputedStyle(bar).paddingRight)');
  assert.ok(Math.abs(heading.width-inner)<1,'Heading spans the full panel width');
  for(const id of ['bookTitle','bookMeta','barProgress'])assert.ok(await js(`bar.querySelector('.heading').contains(${id})`));
  assert.ok(Math.abs((await box('#bar [data-act="shelf"]')).width-inner)<1,'Shelf button spans the row');
  assert.ok(heading.bottom<=(await box('#bar [data-act="shelf"]')).top);
  // 书签、设置按钮在对应模块注册 action 后显示；其余按钮都有可见文字。
  assert.deepEqual(await js(`['bookmarks','settings'].map(a=>document.querySelector('#bar [data-act="'+a+'"]').hidden)`),[false,false]);
  assert.equal(await js(`[...bar.querySelectorAll('.tb')].filter(b=>!b.hidden).every(b=>{const s=b.querySelector('span');return s.textContent.trim()&&s.getBoundingClientRect().width>10;})`),true);
  const columns=()=>js(`new Set([...bar.querySelectorAll('.tb:not(.wide)')].filter(b=>!b.hidden).map(b=>Math.round(b.getBoundingClientRect().left))).size`);
  assert.equal(await columns(),2);
  // 点击面板（位于顶部点击区内）不能穿透到阅读区。
  const scrolled=await js('reader.scrollTop');
  for(const type of ['mousePressed','mouseReleased'])await cdp('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,x:120,y:heading.top+10});
  await delay(150);assert.equal(await js('reader.scrollTop'),scrolled,'Click on the panel does not reach the reader');
  // 离开面板约 450ms 后收起。
  const left=Date.now();await move(600);await delay(200);assert.equal(await js('bar.hidden'),false,'Stays open briefly after leaving');
  await wait(()=>js('bar.hidden'));assert.ok(Date.now()-left>=400);
  // 弹出后指针不经过面板直接移走（模拟悬停事件未补发的情况）也会收起。
  await move(2,height-5);await wait(()=>js('!bar.hidden'));await move(700,height-5);await wait(()=>js('bar.hidden'));
  // 拖动中不触发；有对话框时不触发。
  await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:2,y:height/2,buttons:1,button:'left'});await delay(300);assert.equal(await js('bar.hidden'),true,'No popup while dragging');
  await move(600);await js('help.showModal()');await move(2);await delay(300);assert.equal(await js('bar.hidden'),true,'No popup over a dialog');
  await js('help.close()');await move(600);
  // Esc 收起，T 切换。
  const key=async(k,code)=>{for(const type of ['keyDown','keyUp'])await cdp('Input.dispatchKeyEvent',{type,key:k,code,windowsVirtualKeyCode:k==='Escape'?27:84,text:type==='keyDown'&&k.length===1?k:undefined});};
  await js('reader.focus()');await key('t','KeyT');await wait(()=>js('!bar.hidden'));await key('Escape','Escape');await wait(()=>js('bar.hidden'));
  // 关闭 edgeLeft 后左缘不再弹出，菜单按钮仍可用。
  await js(`localStorage.setItem('mv2:edgeLeft','false')`);await move(2);await delay(400);assert.equal(await js('bar.hidden'),true,'edgeLeft off disables the edge popup');
  const tabBox=await box('#tab');await move(tabBox.left+tabBox.width/2,tabBox.top+tabBox.height/2);await wait(()=>js('!bar.hidden'));
  await move(600);await wait(()=>js('bar.hidden'));
  // 单列布局：约 200px，每个按钮独占一行。
  await js(`localStorage.setItem('mv2:toolbarColumns','1')`);await cdp('Page.reload');
  await wait(()=>js(`bar.dataset.cols==='1'&&bookTitle.textContent==='Toolbar book'`));await js('tab.click()');
  assert.equal(await columns(),1);assert.ok(Math.abs((await box('#bar')).width-200)<=2,'Single-column panel is about 200px wide');
  assert.equal(await js(`[...bar.querySelectorAll('.tb')].filter(b=>!b.hidden).every(b=>getComputedStyle(b).flexDirection==='row')`),true);
  // 面板顶部避开窗口控件覆盖区（--top），高度不足时内部滚动。
  await js(`document.documentElement.style.setProperty('--top','40px')`);
  assert.equal((await box('#bar')).top,40);assert.equal((await box('#tab')).top,48);
  await cdp('Emulation.setDeviceMetricsOverride',{width:800,height:320,deviceScaleFactor:1,mobile:false});
  await wait(()=>js('innerHeight===320'));const small=await box('#bar');
  assert.ok(small.top>=40&&small.bottom<=321,'Panel stays inside the window');assert.ok(await js('bar.scrollHeight>bar.clientHeight&&getComputedStyle(bar).overflowY==="auto"'));
  await cdp('Emulation.clearDeviceMetricsOverride');
  assert.deepEqual(errors,[]);console.log('PASS: left edge popup, leave to close, edgeLeft off, columns 1/2, no click-through, WCO-safe top, Esc / T');
}finally{
  if(ws?.readyState===1){ws.send(JSON.stringify({id:++id,method:'Browser.close'}));ws.close();}
  server.close();for(let i=0;i<30&&chrome.exitCode===null;i++)await delay(100);if(chrome.exitCode===null)chrome.kill();
  await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:150});
}
