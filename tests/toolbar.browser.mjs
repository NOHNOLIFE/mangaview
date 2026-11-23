// 顶部工具栏与底部首尾栏：边缘悬停弹出、离开收起、设置项与布局。框架同 tests/browser.mjs。
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
  await js(`localStorage.setItem('mv2:shelfmarks','false')`);await cdp('Page.reload');await wait(()=>js('document.querySelector("#empty")?.hidden===false'));
  await js(`(async()=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('Toolbar book',{create:true});
    for(let i=0;i<12;i++){const out=await (await dir.getFileHandle(i+'.svg',{create:true})).createWritable();await out.write('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="100%" height="100%" fill="teal"/></svg>');await out.close();}
    window.showDirectoryPicker=async()=>dir;document.querySelector('#empty [data-act="folder"]').click();})()`);
  await wait(()=>js(`bookTitle.textContent==='Toolbar book'&&!!document.querySelector('#reader [data-name="0.svg"] img')`));
  const height=await js('innerHeight'),width=await js('innerWidth'),move=(x,y=height/2)=>cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
  const geometry=()=>js('JSON.stringify([reader.getBoundingClientRect(),reader.clientWidth,reader.scrollTop])');
  const box=sel=>js(`(()=>{const r=document.querySelector('${sel}').getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  const settle=sel=>js(`Promise.all(document.querySelector('${sel}').getAnimations().map(a=>a.finished)).then(()=>true)`);
  // 顶缘悬停约 120ms 弹出；面板浮在正文上，不改变阅读区几何。
  await js('reader.scrollTop=400');await delay(100);const before=await geometry();
  assert.equal(await js('bar.hidden'),true);
  await move(400,400);await move(400,2);await delay(40);assert.equal(await js('bar.hidden'),true,'Edge needs a short dwell');
  await wait(()=>js('!bar.hidden&&document.getElementById("toolbar").classList.contains("open")&&tab.getAttribute("aria-expanded")==="true"'));
  await settle('#bar');await settle('#barTitle');
  assert.equal(await geometry(),before,'Panel overlays the reader without resizing it');
  // 顶部居中的一行图标；书名行在其下方居中；收起文字但有悬停提示。
  const panel=await box('#bar'),view=await box('#reader');
  assert.equal(panel.top,8);assert.ok(Math.abs(panel.x-view.x)<=1,'Toolbar is centred');assert.ok(panel.height<=60,'One row: '+panel.height);
  assert.equal(await js(`new Set([...bar.querySelectorAll('.tb')].filter(b=>!b.hidden).map(b=>Math.round(b.getBoundingClientRect().top))).size`),1);
  assert.deepEqual(await js(`['bookmarks','shelfmarks','settings'].map(a=>document.querySelector('#bar [data-act="'+a+'"]').hidden)`),[false,false,false]);
  assert.equal(await js(`[...bar.querySelectorAll('.tb')].filter(b=>!b.hidden).every(b=>{const s=b.querySelector('span');return s.textContent.trim()&&b.title===s.textContent&&s.getBoundingClientRect().width<=1;})`),true);
  for(const id of ['bookTitle','bookMeta','barProgress'])assert.ok(await js(`!bar.contains(${id})&&barTitle.contains(${id})`));
  const heading=await box('#barTitle');assert.ok(heading.top>=panel.bottom&&Math.abs(heading.x-view.x)<=1&&heading.height<50,'Title row under the toolbar');
  // 点击工具栏不穿透到阅读区（点击正文会翻屏）。
  const scrolled=await js('reader.scrollTop'),sep=await box('#bar .sep');
  for(const type of ['mousePressed','mouseReleased'])await cdp('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,x:sep.x,y:sep.y});
  await delay(150);assert.equal(await js('reader.scrollTop'),scrolled,'Click on the panel does not reach the reader');
  // 离开约 450ms 后淡出收起。
  const left=Date.now();await move(600,600);await delay(200);assert.equal(await js('bar.hidden'),false,'Stays open briefly after leaving');
  await wait(()=>js('bar.classList.contains("leaving")'));await wait(()=>js('bar.hidden'));assert.ok(Date.now()-left>=400);assert.equal(await js('getComputedStyle(barTitle).display'),'none');
  // 弹出后指针不经过面板直接移走也会收起。
  await move(5,2);await wait(()=>js('!bar.hidden'));await move(5,500);await wait(()=>js('bar.hidden'));
  // 拖动中不触发；有对话框时不触发。
  await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:400,y:2,buttons:1,button:'left'});await delay(300);assert.equal(await js('bar.hidden'),true,'No popup while dragging');
  await move(400,500);await js('help.showModal()');await move(400,2);await delay(300);assert.equal(await js('bar.hidden'),true,'No popup over a dialog');
  await js('help.close()');await move(400,500);
  // Esc 收起，T 切换。
  const key=async(k,code)=>{for(const type of ['keyDown','keyUp'])await cdp('Input.dispatchKeyEvent',{type,key:k,code,windowsVirtualKeyCode:k==='Escape'?27:84,text:type==='keyDown'&&k.length===1?k:undefined});};
  await js('reader.focus()');await key('t','KeyT');await wait(()=>js('!bar.hidden'));await key('Escape','Escape');await wait(()=>js('bar.hidden'));
  // 关闭 edgeTop 后顶缘不再弹出，菜单按钮仍可用。
  await js(`localStorage.setItem('mv2:edgeTop','false')`);await move(400,2);await delay(400);assert.equal(await js('bar.hidden'),true,'edgeTop off disables the edge popup');
  const tabBox=await box('#tab');await move(tabBox.x,tabBox.y);await wait(()=>js('!bar.hidden'));
  await move(600,500);await wait(()=>js('bar.hidden'));await js(`localStorage.removeItem('mv2:edgeTop')`);

  // 底缘首尾栏：贴近底缘稍停弹出；书中间时为“回到书首 / 滚到书尾”，到首尾时变为上 / 下一本；离开后收起。
  const [toTop,toEnd,next,prev]=await js(`import('./lang.mjs').then(m=>['toTop','toEnd','next','prev'].map(k=>m.translate(k,document.documentElement.lang)))`);
  const labels=()=>js(`[...endbar.querySelectorAll('.eb')].map(b=>[b.textContent,b.classList.contains('swap')])`);
  const press=async n=>{const b=await box(`#endbar .eb:nth-of-type(${n+1})`);await move(b.x,b.y);for(const type of ['mousePressed','mouseReleased'])await cdp('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,x:b.x,y:b.y});};
  await js('reader.scrollTop=1500');await move(400,height-3);await delay(40);assert.equal(await js('endbar.hidden'),true,'Bottom edge needs a short dwell');
  await wait(()=>js('!endbar.hidden'));await settle('#endbar');
  assert.deepEqual(await labels(),[[toTop,false],[toEnd,false]]);assert.match(await js('endPos.textContent'),/^\d+ \/ 12 · \d+%$/);
  const end=await box('#endbar');assert.ok(Math.abs(end.x-view.x)<=1&&end.bottom<=height-10,'Centred at the bottom');
  await press(1);await wait(()=>js('reader.scrollHeight-reader.scrollTop-reader.clientHeight<=1'));await wait(async()=>JSON.stringify((await labels())[1])===JSON.stringify([next,true]));
  await press(0);await wait(()=>js('reader.scrollTop===0'));await wait(async()=>JSON.stringify((await labels())[0])===JSON.stringify([prev,true]));
  assert.equal(await js('document.activeElement===reader'),true,'Buttons hand focus back to the reader');
  await move(400,400);await wait(()=>js('endbar.hidden'));
  // 点击正文只翻屏：上 / 下 15% 不再跳首尾。
  for(const y of [20,height-20]){const top=await js('reader.scrollTop=600');for(const type of ['mousePressed','mouseReleased'])await cdp('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,x:600,y});
    await delay(100);assert.equal(await js('reader.scrollTop'),600+await js('Math.max(1,reader.clientHeight-64)'),'Right half pages forward at y='+y);await move(400,400);await wait(()=>js('endbar.hidden&&bar.hidden'));}
  await js(`localStorage.setItem('mv2:edgeBottom','false')`);await move(400,height-3);await delay(400);assert.equal(await js('endbar.hidden'),true,'edgeBottom off disables the bottom bar');
  // 旧版的单列 / 双列设置被清除；面板避开窗口控件覆盖区（--top），窄窗口时横向滚动。
  await js(`localStorage.setItem('mv2:toolbarColumns','2')`);await cdp('Page.reload');
  await wait(()=>js(`bookTitle.textContent==='Toolbar book'&&localStorage.getItem('mv2:toolbarColumns')===null`));await js('tab.click()');await wait(()=>js('!bar.hidden'));
  await js(`document.documentElement.style.setProperty('--top','40px')`);await settle('#bar');
  assert.equal((await box('#bar')).top,48);assert.equal((await box('#tab')).top,48);
  await cdp('Emulation.setDeviceMetricsOverride',{width:360,height:500,deviceScaleFactor:1,mobile:false});
  await wait(()=>js('innerWidth===360'));const small=await box('#bar');
  assert.ok(small.left>=0&&small.right<=360,'Panel stays inside the window');assert.ok(await js('bar.scrollWidth>bar.clientWidth&&getComputedStyle(bar).overflowX==="auto"'));
  await cdp('Emulation.clearDeviceMetricsOverride');
  assert.deepEqual(errors,[]);console.log('PASS: top edge popup, centred icon row with tooltips, title row, leave to fade out, edgeTop off, bottom start/end bar, click pages only, WCO-safe top, narrow window, Esc / T');
}finally{
  if(ws?.readyState===1){ws.send(JSON.stringify({id:++id,method:'Browser.close'}));ws.close();}
  server.close();for(let i=0;i<30&&chrome.exitCode===null;i++)await delay(100);if(chrome.exitCode===null)chrome.kill();
  await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:150});
}
