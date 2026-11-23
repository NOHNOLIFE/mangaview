// 全屏缩略图端到端测试：独立临时配置 + OPFS 测试图，不读取用户的书库或浏览器配置。
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const binary=process.argv[2];if(!binary)throw Error('Usage: node tests/overview.browser.mjs <chrome-or-edge-executable>');
const profile=await mkdtemp(join(process.env.MV_TEST_TEMP||tmpdir(),'mv-overview-'));
const mime={mjs:'text/javascript',js:'text/javascript',html:'text/html',webmanifest:'application/manifest+json',png:'image/png',css:'text/css'};
const server=createServer(async(req,res)=>{try{
  const path=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
  if(!/^(?:icons\/)?[\w.-]+$/.test(path))throw Error();
  const data=await readFile(new URL('../'+path,import.meta.url));
  res.writeHead(200,{'Content-Type':mime[path.split('.').pop()],'Cache-Control':'no-cache'});res.end(data);
}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port+'/';
const chrome=spawn(binary,['--headless=new','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--disable-background-networking','--window-size=800,900','about:blank'],{stdio:'ignore'});
let ws,id=0;const pending=new Map(),errors=[];
async function wait(check){let last;for(let i=0;i<150;i++){try{last=await check();if(last)return last;}catch(e){last=e;}await delay(50);}throw Error('Timed out: '+check+'; last: '+last);}
try{
  const port=await wait(async()=>(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);
  const target=(await (await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page');
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(Error(m.error.message));else p.resolve(m.result);}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const js=async expression=>{const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  const shot=async name=>{if(!process.env.MV_SHOTS)return;const {data}=await cdp('Page.captureScreenshot',{format:'png'});await writeFile(join(process.env.MV_SHOTS,name+'.png'),Buffer.from(data,'base64'));};
  await cdp('Runtime.enable');await cdp('Page.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument',{source:`Object.defineProperty(navigator,'languages',{value:['en-US']});`});
  await cdp('Page.navigate',{url:origin});await wait(()=>js('document.querySelector("#empty")?.hidden===false'));
  // 一本 40 张的书：两种比例交替，第 10 张是超长条。
  await js(`(async()=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('Long',{create:true});
    for(let i=0;i<40;i++){const [w,h]=i===9?[400,4000]:i%2?[600,1400]:[600,900];const out=await (await dir.getFileHandle(String(i).padStart(2,'0')+'.svg',{create:true})).createWritable();
      await out.write('<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"><rect width="100%" height="100%" fill="hsl('+i*9+',60%,45%)"/></svg>');await out.close();}
    window.showDirectoryPicker=async()=>dir;document.querySelector('#empty [data-act="folder"]').click();})()`);
  await wait(()=>js(`bookTitle.textContent==='Long'`));
  const W=await js('innerWidth');
  const move=(x,y=150)=>cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
  const keys={d:['KeyD',68],s:['KeyS',83],w:['KeyW',87],a:['KeyA',65],v:['KeyV',86],']':['BracketRight',221],ArrowRight:['ArrowRight',39],ArrowLeft:['ArrowLeft',37],ArrowDown:['ArrowDown',40],ArrowUp:['ArrowUp',38],Home:['Home',36],End:['End',35],Enter:['Enter',13],' ':['Space',32],Escape:['Escape',27],g:['KeyG',71],c:['KeyC',67],'[':['BracketLeft',219]};
  const press=async k=>{const [code,vk]=keys[k],text=k.length===1?k:k==='Enter'?'\r':undefined,modifiers=0;
    await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:k,code,windowsVirtualKeyCode:vk,modifiers,...(text?{text}:{})});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:k,code,windowsVirtualKeyCode:vk,modifiers});};
  const isOpen=()=>js('overview.open&&!overview.classList.contains("closing")'),closed=()=>js('!overview.open');
  const sel=()=>js(`(()=>{const n=document.querySelector('.ov-item.sel');return n&&{i:+n.dataset.i,x:parseFloat(n.style.left),y:parseFloat(n.style.top)};})()`);
  const pos=()=>js('document.querySelector(".ov-pos").textContent');
  // 右缘悬停：直接打开全屏总览，不弹窄条；选中当前页。
  await move(400);await move(W-2);await wait(isOpen);
  assert.equal(await js('document.getElementById("panel").hidden'),true,'No strip when the overview opens');
  assert.equal(await pos(),'Page 1 / 40');assert.equal((await sel()).i,0);
  // 瀑布流：多列、互不重叠；滚动条加宽。
  const boxes=await js(`[...document.querySelectorAll('.ov-item')].map(n=>[parseFloat(n.style.left),parseFloat(n.style.top),parseFloat(n.style.width),parseFloat(n.style.height)])`);
  assert.ok(new Set(boxes.map(b=>b[0])).size>=4,'Several columns');
  for(const [i,a] of boxes.entries())for(const b of boxes.slice(i+1))assert.ok(a[0]+a[2]<=b[0]||b[0]+b[2]<=a[0]||a[1]+a[3]<=b[1]||b[1]+b[3]<=a[1],'Tiles do not overlap');
  assert.equal(await js('(s=>s.offsetWidth-s.clientWidth)(document.querySelector(".ov-scroll"))'),20,'Wide scrollbar');
  await wait(()=>js('document.querySelectorAll(".ov-item canvas").length>=10'));
  assert.ok(await js('(n=>n.offsetHeight<=n.offsetWidth*3+1)(document.querySelector(\'.ov-item[data-i="9"]\'))'),'Long strips are capped');
  // 键盘：A/D、←/→ 按页序；W/S、↑/↓ 在同一列移动。
  await press('d');await press('ArrowRight');assert.equal((await sel()).i,2);assert.equal(await pos(),'Page 3 / 40');
  const a=await sel();await press('s');const b=await sel();assert.equal(b.x,a.x);assert.ok(b.y>a.y&&b.i>a.i,'S moves down the same column');
  await press('ArrowDown');const c=await sel();assert.equal(c.x,a.x);assert.ok(c.y>b.y);
  await press('w');await press('ArrowUp');assert.deepEqual(await sel(),a);await press('a');await press('ArrowLeft');assert.equal((await sel()).i,0);
  await press('End');await wait(async()=>(await sel())?.i===39);await delay(300);assert.ok(await js('(s=>{const n=document.querySelector(".ov-item.sel").getBoundingClientRect(),r=s.getBoundingClientRect();return n.top>=r.top&&n.bottom<=r.bottom;})(document.querySelector(".ov-scroll"))'),'Selection scrolled into view');
  // Enter 跳到该页顶部并关闭。
  await press('Home');for(let i=0;i<9;i++)await press('d');await wait(async()=>(await sel())?.i===9);await press('Enter');await wait(closed);
  const at=n=>js(`Math.abs(parseFloat(document.querySelector('#reader .page[data-n="${n}"]').style.top)-reader.scrollTop)<2`);
  await wait(()=>at(10));
  // 关闭后鼠标仍在右缘：不再打开，也不弹窄条；离开后回来才再打开。
  await move(W-3);await delay(400);assert.equal(await js('overview.open'),false,'No reopen while still at the edge');assert.equal(await js('document.getElementById("panel").hidden'),true);
  await move(400);await move(W-2);await wait(isOpen);assert.equal((await sel()).i,9,'Opens at the current page');
  // 点击缩略图跳转并关闭。
  const box=await js(`(()=>{const r=document.querySelector('.ov-item[data-i="11"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await move(box.x,box.y);for(const type of ['mousePressed','mouseReleased'])await cdp('Input.dispatchMouseEvent',{type,x:box.x,y:box.y,button:'left',clickCount:1});
  await wait(closed);await wait(()=>at(12));
  // V / | 打开、关闭；Esc 关闭；空格选择。
  await move(400);await js('reader.focus()');await press('v');await wait(isOpen);await press('v');await wait(closed);
  await press(']');await wait(isOpen);await press('Escape');await wait(closed);
  await press(']');await wait(isOpen);await press('d');await press(' ');await wait(closed);await wait(()=>at(13));
  // 不是从阅读区进入的不触发：从顶部边带进入右缘再往下移。
  await move(400,5);await move(W-2,5);await move(W-2,150);await delay(400);assert.equal(await js('overview.open'),false,'Entering from the top band does not trigger');
  // 只在右上角触发：右缘下方照旧弹出窄条；在窄条里往上移进上角不触发。
  await move(400,500);await delay(500);await move(W-2,500);await wait(()=>js('!document.getElementById("panel").hidden'));assert.equal(await js('overview.open'),false,'Lower right edge shows the strip');
  await move(W-60,500);await move(W-60,150);await move(W-2,150);await delay(400);assert.equal(await js('overview.open'),false,'Moving up inside the strip does not trigger');
  await move(400,500);await wait(()=>js('document.getElementById("panel").hidden'));
  // 全屏书架书签：先在两本书里加书签（长按 G）。
  const holdG=async()=>{await js('reader.focus()');await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'g',code:'KeyG',windowsVirtualKeyCode:71,text:'g'});await delay(750);await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'g',code:'KeyG',windowsVirtualKeyCode:71});};
  const count=()=>js('document.querySelectorAll("#shelfmarks .bm-item").length');
  await move(400);await js('reader.scrollTop=3000');await delay(100);await holdG();await wait(async()=>await count()===1);
  await js('reader.scrollTop=9000');await delay(100);await holdG();await wait(async()=>await count()===2);
  await js(`(async()=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('Short',{create:true});
    for(let i=0;i<4;i++){const out=await (await dir.getFileHandle(i+'.svg',{create:true})).createWritable();await out.write('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="100%" height="100%" fill="navy"/></svg>');await out.close();}
    window.showDirectoryPicker=async()=>dir;document.querySelector('#bar [data-act="folder"]').click();})()`);
  await wait(()=>js(`bookTitle.textContent==='Short'`));await js('reader.scrollTop=500');await delay(100);await holdG();await wait(async()=>await count()===3);
  await js(`document.querySelector('#bar [data-act="next"]').click()`);await wait(()=>js(`bookTitle.textContent==='Long'`));await js('reader.scrollTop=9000');await delay(100);
  // C 打开：按书分组（书架顺序：最后添加的 Short 在前），当前书高亮，选中屏幕中心处的书签。
  const msel=()=>js('(n=>n&&+n.dataset.k)(document.querySelector("#shelfOverview .ov-mark.sel"))');
  const mOpen=()=>js('shelfOverview.open&&!shelfOverview.classList.contains("closing")'),mClosed=()=>js('!shelfOverview.open');
  await js('reader.focus()');await press('c');await wait(mOpen);
  assert.equal(await js('[...document.querySelectorAll("#shelfOverview .ov-sec-head strong")].map(n=>n.textContent).join()'),'Short,Long');
  assert.equal(await js('document.querySelector("#shelfOverview .ov-sec.current strong").textContent'),'Long');
  assert.equal(await msel(),2);assert.equal(await js('document.querySelector("#shelfOverview .ov-pos").textContent'),'Bookmark 3 / 3 · Long');
  await press('a');assert.equal(await msel(),1);await press('w');assert.equal(await msel(),0,'W goes to the row above');await press('s');assert.equal(await msel(),1);
  await press('ArrowLeft');assert.equal(await msel(),0);
  // Enter 跨书跳转并关闭；' 再打开时选中刚跳到的书签；V 切到全屏缩略图。
  await press('Enter');await wait(mClosed);await wait(()=>js(`bookTitle.textContent==='Short'`));
  await press('[');await wait(mOpen);assert.equal(await msel(),0);await press('v');await wait(isOpen);assert.equal(await js('shelfOverview.open'),false,'V switches to thumbnails');
  await press('c');await wait(mOpen);assert.equal(await js('overview.open'),false,'C switches back');await press('[');await wait(mClosed);
  // 左侧：专注模式下固定的书架书签列表，从阅读区移入即打开；在列表里上下移动、从顶部边带进入都不触发。
  const lx=await js('(r=>r.left+r.width/2)(document.getElementById("shelfmarks").getBoundingClientRect())');
  await move(400);await move(lx);await wait(mOpen);await press('Escape');await wait(mClosed);
  await move(400,500);await move(lx,500);await move(lx,150);await delay(300);assert.equal(await js('shelfOverview.open'),false,'Entering the lower list and moving up does not trigger');
  await move(400,5);await move(lx,5);await move(lx,150);await delay(300);assert.equal(await js('shelfOverview.open'),false,'Entering from the top band does not trigger');
  await move(400);await move(lx);await wait(mOpen);await shot('shelf-overview');
  const mark1=await js(`(()=>{const r=document.querySelectorAll('#shelfOverview .ov-mark')[2].getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await move(mark1.x,mark1.y);for(const type of ['mousePressed','mouseReleased'])await cdp('Input.dispatchMouseEvent',{type,x:mark1.x,y:mark1.y,button:'left',clickCount:1});
  await wait(mClosed);await wait(()=>js(`bookTitle.textContent==='Long'`));
  // 专注模式下固定的缩略图栏：鼠标一进入就打开；关闭后在栏内移动不会再开，离开再进入才开。
  await js(`document.querySelector('#bar [data-act="preview"]').click()`);await wait(()=>js('document.body.classList.contains("docked")&&document.body.classList.contains("focus-mode")'));
  const px=await js('(r=>r.left+r.width/2)(document.getElementById("panel").getBoundingClientRect())');
  await move(300);await move(px);await wait(isOpen);await press('Escape');await wait(closed);
  await move(px+5);await move(px-5);await delay(300);assert.equal(await js('overview.open'),false,'No reopen inside the strip');
  await move(300,500);await move(px,500);await move(px,150);await delay(300);assert.equal(await js('overview.open'),false,'Lower part of the pinned strip does not trigger');
  await move(300);await move(px);await wait(isOpen);await press('Escape');await wait(closed);
  // 拖宽度的把手不触发。
  const gx=await js('(r=>r.left+r.width/2)(document.getElementById("grip").getBoundingClientRect())');
  await move(300);await move(gx);await delay(300);assert.equal(await js('overview.open'),false,'Grip does not open it');
  // 关闭专注模式：固定栏照常显示，不打开总览。
  await move(300);await js('document.body.classList.remove("focus-mode")');await move(px);await delay(300);assert.equal(await js('overview.open'),false);
  // 关闭设置：右缘恢复弹出窄条；V 仍可打开。
  await js(`document.querySelector('#bar [data-act="preview"]').click();localStorage.setItem('mv2:overview','false')`);
  await move(300);await move(W-2);await wait(()=>js('!document.getElementById("panel").hidden'));assert.equal(await js('overview.open'),false,'Setting off: strip instead');
  await move(300);await js('reader.focus()');await press('v');await wait(isOpen);await shot('overview');await press('Escape');await wait(closed);
  assert.deepEqual(errors,[]);console.log('PASS: full-screen shelf bookmarks (left edge / pinned list, C and [ keys, grouping, navigation, cross-book jump), entry only from the page, full-screen thumbnails from the right edge and the focus-mode strip, masonry layout, wide scrollbar, WASD / arrows, Space / Enter / click to jump, V and ] toggle, re-arm after closing, setting off');
}finally{
  if(ws?.readyState===1){ws.send(JSON.stringify({id:++id,method:'Browser.close'}));ws.close();}
  server.close();for(let i=0;i<30&&chrome.exitCode===null;i++)await delay(100);if(chrome.exitCode===null)chrome.kill();
  await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:150});
}
