// 书架书签与单列工具栏端到端测试：独立临时配置 + OPFS 测试图，不读取用户的书库或浏览器配置。
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const binary=process.argv[2];if(!binary)throw Error('Usage: node tests/shelfmarks.browser.mjs <chrome-or-edge-executable>');
const profile=await mkdtemp(join(process.env.MV_TEST_TEMP||tmpdir(),'mv-shelfmarks-'));
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
  // 全屏缩略图 / 全屏书架书签由 overview.browser.mjs 覆盖；这里关掉，避免悬停列表左上部时打开全屏。
  await cdp('Page.addScriptToEvaluateOnNewDocument',{source:`Object.defineProperty(navigator,'languages',{value:['en-US']});localStorage.setItem('mv2:overview','false');localStorage.setItem('mv2:smOverview','false');`});
  await cdp('Page.navigate',{url:origin});await wait(()=>js('document.querySelector("#empty")?.hidden===false'));
  // 默认常驻；先取消常驻，测试开关前后的差别。
  assert.equal(await js(`!document.getElementById('shelfmarks').hidden&&document.body.classList.contains('shelfmarks')`),true,'Pinned by default');
  await js(`localStorage.setItem('mv2:shelfmarks','false')`);await cdp('Page.reload');await wait(()=>js('document.querySelector("#empty")?.hidden===false&&document.getElementById("shelfmarks").hidden'));
  // 两本 10 页的书：Alpha、Beta（书架顺序按书名）。图与默认尺寸 800×1120 相同，便于按像素换算位置。
  async function book(name,first){
    await js(`(async()=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('${name}',{create:true});
      for(let i=0;i<10;i++){const out=await (await dir.getFileHandle(i+'.svg',{create:true})).createWritable();
        await out.write('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1120"><rect width="100%" height="100%" fill="hsl('+i*47+',55%,38%)"/></svg>');await out.close();}
      window.showDirectoryPicker=async()=>dir;document.querySelector('${first?'#empty':'#bar'} [data-act="folder"]').click();})()`);
    await wait(()=>js(`bookTitle.textContent==='${name}'&&document.querySelector('#reader [data-name="0.svg"] img')?.naturalHeight===1120`));
    await js('reader.focus()');
  }
  const ph=()=>js('reader.clientWidth*1.4'),H=()=>js('reader.clientHeight');
  const goto=async(n,f)=>js(`reader.scrollTop=${(n+f)*await ph()-await H()/2}`);
  const center=async()=>{const p=await ph();return js(`(()=>{const c=Math.round((reader.scrollTop+reader.clientHeight/2)/${p}*100)/100;return [bookTitle.textContent,Math.floor(c),+(c-Math.floor(c)).toFixed(2)];})()`);};
  const text=()=>js(`document.getElementById('notice').textContent`);
  const codes={g:['KeyG',71,'g']};
  async function key(name,type){const [code,vk,t]=codes[name];await cdp('Input.dispatchKeyEvent',{type,key:name,code,windowsVirtualKeyCode:vk,...(type==='keyDown'?{text:t}:{})});}
  const tap=async()=>{await key('g','keyDown');await delay(40);await key('g','keyUp');};
  const hold=async()=>{await key('g','keyDown');await delay(700);await key('g','keyUp');};
  const count=()=>js('JSON.parse(localStorage.getItem("mv2:last"))').then(id=>js(`import('./store.mjs').then(async({library})=>(await library('getAll')).reduce((n,b)=>n+b.bookmarks.length,0))`));
  const mouse=(type,x,y,button='none')=>cdp('Input.dispatchMouseEvent',{type,x,y,button,clickCount:button==='none'?0:1});
  const click=async(x,y)=>{await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,'left');await mouse('mouseReleased',x,y,'left');};
  const box=sel=>js(`(()=>{const r=document.querySelector('${sel}').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};})()`);

  await book('Alpha',true);await goto(2,.5);await hold();await wait(async()=>await count()===1);await goto(6,.5);await hold();await wait(async()=>await count()===2);
  await book('Beta',false);await goto(3,.5);await hold();await wait(async()=>await count()===3);
  await js(`shelfSort.value='nameAsc';shelfSort.dispatchEvent(new Event('change'))`); // 书架顺序按名称，便于断言
  // 关闭时：短按只在本书内循环。
  await js('reader.scrollTop=0');await tap();await wait(async()=>(await center())[1]===3);assert.equal(await text(),'Bookmark 1 / 1');
  assert.equal(await js('document.getElementById("shelfmarks").hidden'),true);

  // 开启：左侧常驻列表，正文让出宽度；按书架顺序分组。
  const btn='#bar [data-act="shelfmarks"]';
  assert.equal(await js(`document.querySelector('${btn}').hidden`),false);
  await js(`document.querySelector('${btn}').click()`);
  await wait(()=>js(`!document.getElementById('shelfmarks').hidden&&document.querySelector('${btn}').getAttribute('aria-pressed')==='true'`));
  const dock=await box('#shelfmarks'),reader=await box('#reader');
  assert.ok(Math.abs(dock.width-260)<=1&&dock.left===0,'Dock is 260px at the left: '+dock.width);assert.ok(Math.abs(reader.left-dock.right)<=1,'Reader starts after the dock');
  assert.deepEqual(await js(`[...document.querySelectorAll('#shelfmarks .sm-book')].map(s=>[s.getAttribute('aria-label'),[...s.querySelectorAll('.bm-item')].map(p=>p.getAttribute('aria-label')).join(),s.classList.contains('current')])`),
    [['Alpha','Alpha · Image 3,Alpha · Image 7',false],['Beta','Beta · Image 4',true]]);
  // 紧凑显示：不显示书名、文件名或页码文字；缩略图比例限制在 3:4 ~ 4:3。
  assert.equal(await js(`document.querySelector('#shelfmarks .sm-list').innerText.trim()`),'');
  const ar=await js(`(()=>{const r=document.querySelector('#shelfmarks .bm-thumb').getBoundingClientRect();return r.width/r.height;})()`);assert.ok(ar>=.74&&ar<=1.34,'Thumbnail is not a strip: '+ar);
  assert.equal(await js(`document.querySelector('#shelfmarks .sm-head').textContent`),'Shelf bookmarks3');
  await wait(()=>js(`[...document.querySelectorAll('#shelfmarks .bm-item img')].every(i=>i.complete&&i.naturalWidth>0)`));
  await shot('shelfmarks');
  // 悬停不跳转，点击才跳转（跨书）。
  const item=(b,n)=>box(`#shelfmarks .sm-book:nth-child(${b}) .bm-item:nth-child(${n}) .bm-thumb`);
  await delay(300); // 打开列表后正文变窄重排，等位置稳定再比较
  let p=await item(1,2);const before=await center();await mouse('mouseMoved',p.x,p.y);await delay(300);assert.deepEqual(await center(),before,'Hover does not jump');
  await click(p.x,p.y);await wait(async()=>JSON.stringify(await center())===JSON.stringify(['Alpha',6,.5]));
  assert.equal(await js(`document.querySelector('#shelfmarks .sm-book:nth-child(1)').classList.contains('current')&&document.querySelector('#shelfmarks .sm-book:nth-child(1) .bm-item:nth-child(2)').classList.contains('active')`),true);
  assert.equal(await js('document.activeElement===reader'),true,'Focus returns to the reader');
  // 短按 G 沿列表跨书前进，末尾回到开头。
  await tap();await wait(async()=>JSON.stringify(await center())===JSON.stringify(['Beta',3,.5]));assert.equal(await text(),'Bookmark 3 / 3 · Beta');
  await tap();await wait(async()=>JSON.stringify(await center())===JSON.stringify(['Alpha',2,.5]));assert.equal(await text(),'Back to the first bookmark');
  await tap();await wait(async()=>JSON.stringify(await center())===JSON.stringify(['Alpha',6,.5]));assert.equal(await text(),'Bookmark 2 / 3');
  // 从书中间开始：先找本书屏幕中心之后的书签。
  await goto(1,0);await tap();await wait(async()=>JSON.stringify(await center())===JSON.stringify(['Alpha',2,.5]));assert.equal(await text(),'Bookmark 1 / 3');
  p=await item(2,1);await click(p.x,p.y);await wait(async()=>JSON.stringify(await center())===JSON.stringify(['Beta',3,.5]));
  // 在列表里删除书签。
  p=await item(1,1);await mouse('mouseMoved',p.x,p.y);const del=await box('#shelfmarks .sm-book:nth-child(1) .bm-item:nth-child(1) .bm-del');
  await click(del.x,del.y);await wait(async()=>await count()===2);await wait(()=>js(`document.querySelectorAll('#shelfmarks .bm-item').length===2`));
  assert.equal((await center())[0],'Beta','Deleting does not switch books');

  // 工具栏：顶部横向一行图标，居中于阅读区（不压在常驻书签列表上）；书名行在工具栏下方。
  await js('tab.click()');await wait(()=>js('!bar.hidden'));await js('Promise.all([...bar.getAnimations(),...barTitle.getAnimations()].map(a=>a.finished)).then(()=>true)');
  const bar=await box('#bar'),rd=await box('#reader'),head=await box('#barTitle');
  assert.ok(bar.left>=rd.left+7&&bar.right<=rd.right-7&&Math.abs(bar.x-rd.x)<=1,'Toolbar is centred over the reader: '+JSON.stringify([bar,rd]));
  assert.equal(await js(`new Set([...bar.querySelectorAll('.tb')].filter(b=>!b.hidden).map(b=>Math.round(b.offsetTop))).size`),1,'Single row');
  assert.ok(head.top>=bar.bottom&&Math.abs(head.x-rd.x)<=1,'Title row sits under the toolbar');
  await shot('toolbar-over-dock');
  await mouse('mouseMoved',bar.x,bar.y);await mouse('mouseMoved',400,600);await wait(()=>js('bar.hidden'));
  assert.equal(await js('getComputedStyle(barTitle).display'),'none','Title hides with the toolbar');
  // 专注模式（默认开）：鼠标不在列表上时内容透明但仍占位，底色为当前画面左缘颜色的渐变；悬停时恢复。
  const opacity=sel=>js(`getComputedStyle(document.querySelector('${sel}')).opacity`);
  await wait(async()=>await opacity('#shelfmarks .sm-list')==='0');assert.ok(Math.abs((await box('#reader')).left-dock.right)<=1,'Dock keeps its space');
  const bg=sel=>js(`(l=>l?getComputedStyle(l).backgroundImage:'none')(document.querySelector('${sel}>.ambient>i.on'))`); // 专注模式底色画在侧栏里当前显示的那层上
  const tint=await js(`(()=>{const c=document.createElement('canvas');c.width=c.height=1;const g=c.getContext('2d');g.fillStyle='hsl(${3*47},55%,38%)';g.fillRect(0,0,1,1);return [...g.getImageData(0,0,1,1).data].slice(0,3).map(v=>Math.round(v*.85));})()`);
  await wait(async()=>(await bg('#shelfmarks')).includes('rgb('+tint.join(', ')+')'));await shot('focus-idle');
  // 跨书跳到书签（画面换成别的颜色）后，底色跟着变；滚动途中任何时刻都不回落成纯黑。
  const color=n=>js(`(()=>{const c=document.createElement('canvas');c.width=c.height=1;const g=c.getContext('2d');g.fillStyle='hsl(${n*47},55%,38%)';g.fillRect(0,0,1,1);return 'rgb('+[...g.getImageData(0,0,1,1).data].slice(0,3).map(v=>Math.round(v*.85)).join(', ')+')';})()`);
  await tap();await wait(async()=>(await center())[0]==='Alpha');const want=await color((await center())[1]);
  await wait(async()=>(await bg('#shelfmarks')).split('rgb(').length>5&&(await bg('#shelfmarks')).split(want).length>5);
  // 连续滚动期间不更新（停下约 200ms 后才取色），也不回落成纯黑。
  const b0=await bg('#shelfmarks'),dark=[],changed=[];for(let y=0;y<12;y++){await js('reader.scrollTop+=180');await delay(30);const b=await bg('#shelfmarks');if(b==='none'||b.includes('rgb(10, 10, 12)'))dark.push(y);if(b!==b0)changed.push(y);}
  assert.deepEqual(dark,[],'No fallback to black while scrolling');assert.deepEqual(changed,[],'No update while scrolling');
  await wait(async()=>await bg('#shelfmarks')!==b0);
  await mouse('mouseMoved',dock.x,dock.y);await wait(async()=>await opacity('#shelfmarks .sm-list')==='1');
  assert.equal(await js(`getComputedStyle(document.getElementById('shelfmarks'),'::before').opacity`),'1','Solid layer fades in on hover');await mouse('mouseMoved',400,600);await wait(async()=>await opacity('#shelfmarks .sm-list')==='0');
  // 停靠的缩略图栏同样处理，底色取右缘颜色。
  await js(`document.querySelector('#bar [data-act="preview"]').click()`);await wait(()=>js(`document.body.classList.contains('docked')`));
  await wait(async()=>await opacity('#preview')==='0'&&(await bg('#panel')).startsWith('linear-gradient(rgb('));
  // 停靠栏中上部悬停显示内容（下角才打开全屏缩略图，见 overview.browser.mjs）。
  const pv=await box('#panel');await mouse('mouseMoved',pv.x,pv.y);await wait(async()=>await opacity('#preview')==='1');
  await mouse('mouseMoved',400,600);await js(`document.querySelector('#bar [data-act="preview"]').click()`);
  // 关闭专注模式：内容始终显示。
  await js(`localStorage.setItem('mv2:focusMode','false')`);await cdp('Page.reload');await wait(()=>js(`bookTitle.textContent==='Alpha'`));
  await mouse('mouseMoved',400,600);await delay(300);assert.equal(await opacity('#shelfmarks .sm-list'),'1');assert.equal(await js(`document.body.classList.contains('focus-mode')`),false);
  // 开关状态持久保存。
  await cdp('Page.reload');await wait(()=>js(`bookTitle.textContent==='Alpha'&&!document.getElementById('shelfmarks').hidden`));
  await wait(()=>js(`document.querySelectorAll('#shelfmarks .bm-item').length===2`));
  // 书架页「清空书架」：二次确认，取消则不删除；确认后删除书架上全部书目，书签列表随之清空。
  const total=()=>js('import("./store.mjs").then(async({library})=>(await library("getAll")).length)');
  await js(`document.querySelector('#bar [data-act="shelf"]').click()`);await wait(()=>js('shelf.open'));
  await js(`document.querySelector('#views [data-view="shelf"]').click()`);
  const clear=`[...bulkActions.querySelectorAll('button')].find(b=>b.textContent.startsWith('Clear shelf'))`;
  assert.equal(await js(`${clear}?.textContent`),'Clear shelf (2)');
  await js(`window.confirm=()=>false;${clear}.click()`);await delay(300);assert.equal(await total(),2,'Cancel keeps the books');
  await js(`window.confirm=m=>(window.asked=m,true);${clear}.click()`);await wait(async()=>await total()===0);
  assert.match(await js('window.asked'),/^Clear the shelf\? .* all 2 books/);assert.equal(await js(`!!${clear}`),false);
  await js('shelf.close()');await wait(()=>js(`!!document.querySelector('#shelfmarks .bm-empty')&&!document.querySelector('#shelfmarks .bm-item')`));
  // 关闭：正文恢复全宽。
  await js(`document.querySelector('${btn}').click()`);await wait(()=>js('document.getElementById("shelfmarks").hidden'));
  assert.equal((await box('#reader')).left,0);assert.equal(await js(`document.querySelector('${btn}').getAttribute('aria-pressed')`),'false');
  // 未常驻：鼠标贴近左缘稍停弹出浮动列表（不挤压正文），移开后淡出收起。
  await mouse('mouseMoved',400,400);await mouse('mouseMoved',2,400);await delay(40);assert.equal(await js('document.getElementById("shelfmarks").hidden'),true,'Edge needs a short dwell');
  await wait(()=>js(`(s=>!s.hidden&&s.classList.contains('floating'))(document.getElementById('shelfmarks'))`));assert.equal((await box('#reader')).left,0,'Floating list overlays the reader');
  await mouse('mouseMoved',100,300);await delay(300);assert.equal(await js('document.getElementById("shelfmarks").hidden'),false,'Stays open while hovered');
  await mouse('mouseMoved',600,300);await wait(()=>js('document.getElementById("shelfmarks").classList.contains("leaving")'));await wait(()=>js('document.getElementById("shelfmarks").hidden'));
  assert.deepEqual(errors,[]);console.log('PASS: shelf bookmark dock, hover vs click, cross-book G, delete, top toolbar, title row, focus mode, persistence, floating at the left edge');
}finally{
  if(ws?.readyState===1){ws.send(JSON.stringify({id:++id,method:'Browser.close'}));ws.close();}
  server.close();for(let i=0;i<30&&chrome.exitCode===null;i++)await delay(100);if(chrome.exitCode===null)chrome.kill();
  await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:150});
}
