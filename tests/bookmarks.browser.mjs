// 书签端到端测试：独立临时配置 + OPFS 测试图，不读取用户的书库或浏览器配置。
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const binary=process.argv[2];if(!binary)throw Error('Usage: node tests/bookmarks.browser.mjs <chrome-or-edge-executable>');
const profile=await mkdtemp(join(process.env.MV_TEST_TEMP||tmpdir(),'mv-bookmarks-'));
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
  await cdp('Page.addScriptToEvaluateOnNewDocument',{source:`Object.defineProperty(navigator,'languages',{value:['en-US']});try{localStorage.setItem('mv2:shelfmarks','false');}catch{}`});
  await cdp('Page.navigate',{url:origin});await wait(()=>js('document.querySelector("#empty")?.hidden===false'));
  // 与默认尺寸 800×1120 相同的图：未加载的页也不会因测量而移位，便于按像素换算位置。
  await js(`(async()=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('Marked',{create:true});
    for(let i=0;i<30;i++){const out=await (await dir.getFileHandle(i+'.svg',{create:true})).createWritable();
      await out.write('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1120"><rect width="100%" height="100%" fill="hsl('+i*47+',55%,38%)"/><text x="400" y="600" font-size="260" text-anchor="middle" fill="white" font-family="sans-serif">'+i+'</text></svg>');await out.close();}
    window.showDirectoryPicker=async()=>dir;document.querySelector('#empty [data-act="folder"]').click();})()`);
  await wait(()=>js(`document.querySelector('#reader [data-name="0.svg"] img')?.naturalHeight===1120`));
  await js('reader.focus()');
  const H=await js('reader.clientHeight'),ph=await js('reader.clientWidth*1.4');
  const goto=(n,f)=>js(`reader.scrollTop=${n*ph+f*ph-H/2}`);
  const center=()=>js(`(()=>{const c=(reader.scrollTop+reader.clientHeight/2)/${ph};return [Math.floor(c),+(c-Math.floor(c)).toFixed(3)];})()`);
  const record=()=>js(`import('./store.mjs').then(async({library})=>(await library('getAll')).find(b=>b.id===JSON.parse(localStorage.getItem('mv2:last'))))`);
  const marks=async()=>(await record()).bookmarks.map(b=>[b.name,+b.f.toFixed(3)]);
  const text=()=>js(`document.getElementById('notice').textContent`);
  const codes={f:['KeyF',70,'f'],F:['KeyF',70,'F'],g:['KeyG',71,'g'],Enter:['Enter',13,'\r'],Escape:['Escape',27,'']};
  // shift：按住 Shift（反向跳转）。
  async function key(name,type,shift=false){const [code,vk,t]=codes[name];await cdp('Input.dispatchKeyEvent',{type,key:name,code,windowsVirtualKeyCode:vk,...(shift?{modifiers:8}:{}),...(type==='keyDown'&&t?{text:t}:{})});}
  const tap=async(name='f',shift=false)=>{await key(name,'keyDown',shift);await delay(40);await key(name,'keyUp',shift);};
  async function hold(name='f'){
    await key(name,'keyDown');await delay(320);
    assert.equal(await js('!document.querySelector(".hold").hidden'),true,'Ring appears while holding');
    assert.equal(await js('document.querySelector(".hold .hold-text").textContent'),'Keep holding to add a bookmark');
    await delay(380);await key(name,'keyUp');
  }

  // 没有书签时短按给出提示。
  await goto(3,.5);await tap();await wait(async()=>await text()==='No bookmarks yet — hold F or Enter to add one');
  // G 不再绑定：长按不添加书签。
  await key('g','keyDown');await delay(700);await key('g','keyUp');await delay(100);assert.equal((await marks()).length,0,'G is no longer bound');
  // 长按 G 添加书签，缩略图存进 thumbs store。
  await hold();await wait(async()=>(await marks()).length===1);
  assert.deepEqual(await marks(),[['3.svg',.5]]);assert.equal(await text(),'Bookmark added');
  assert.ok(await js('document.querySelector(".hold").classList.contains("done")'),'Completion state is shown');
  await shot('hold-done');
  const book=await record(),thumbKey=book.id+':bm:'+book.bookmarks[0].id;
  const thumb=await wait(()=>js(`import('./store.mjs').then(async({thumbs})=>{const t=await thumbs('get','${thumbKey}');return t&&[t.blob.type,t.w,t.h];})`));
  const W=await js('reader.clientWidth');assert.deepEqual(thumb,['image/webp',240,Math.round(240*H/W)],'Thumbnail crops the viewport-shaped area around the centre');
  // 同一张图内、距离小于半屏：拒绝重复添加。中途松开：取消并按短按处理。
  await goto(3,.6);await hold();await wait(async()=>await text()==='There is already a bookmark here');
  assert.equal((await marks()).length,1);
  await goto(10,.25);await key('Enter','keyDown');await delay(250);await key('Enter','keyUp');
  await wait(async()=>await text()==='Back to the first bookmark');assert.deepEqual(await center(),[3,.5]);assert.equal((await marks()).length,1);
  await goto(10,.25);await hold('Enter');await goto(20,.75);await hold();
  await wait(async()=>(await marks()).length===3);await wait(async()=>(await js(`import('./store.mjs').then(({thumbs})=>thumbs('getAllKeys'))`)).filter(k=>k.includes(':bm:')).length===3);
  // 短按依次跳到下一个书签，末尾后回到第一个。
  await js('reader.scrollTop=0');await tap();await wait(async()=>(await center())[0]===3);assert.equal(await text(),'Bookmark 1 / 3');
  await tap();await wait(async()=>(await center())[0]===10);assert.deepEqual(await center(),[10,.25]);assert.equal(await text(),'Bookmark 2 / 3');
  await tap();await wait(async()=>(await center())[0]===20);assert.equal(await text(),'Bookmark 3 / 3');
  await tap();await wait(async()=>(await center())[0]===3);assert.equal(await text(),'Back to the first bookmark');
  // Shift+F / Shift+Enter：反向跳到上一个书签，开头之前回到最后一个。
  await tap('F',true);await wait(async()=>(await center())[0]===20);assert.equal(await text(),'Back to the last bookmark');
  await tap('F',true);await wait(async()=>(await center())[0]===10);assert.equal(await text(),'Bookmark 2 / 3');
  await tap('Enter',true);await wait(async()=>(await center())[0]===3);assert.equal(await text(),'Bookmark 1 / 3');
  // 不是刚跳过来的位置：从屏幕中心往前找。
  await goto(15,.5);await tap('F',true);await wait(async()=>(await center())[0]===10);assert.deepEqual(await center(),[10,.25]);
  // 长按 Shift+F 同样添加书签（这里已有书签，提示重复）。
  await js('notice.textContent=""');await key('F','keyDown',true);await delay(700);await key('F','keyUp',true);await wait(async()=>await text()==='There is already a bookmark here');

  // 右键在鼠标处打开面板，“添加书签”按钮正好在鼠标下。
  const mouse=(type,x,y,button='none')=>cdp('Input.dispatchMouseEvent',{type,x,y,button,clickCount:button==='none'?0:1});
  async function menu(x,y){await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,'right');await mouse('mouseReleased',x,y,'right');await wait(()=>js('!document.querySelector(".bm-panel").hidden'));await delay(200);}
  const rect=sel=>js(`(()=>{const r=document.querySelector('${sel}').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,left:r.left,top:r.top,right:r.right,bottom:r.bottom};})()`);
  await goto(5,.5);const start=await center();
  await menu(300,400);const add=await rect('.bm-add');
  assert.ok(Math.abs(add.x-300)<1&&Math.abs(add.y-400)<1,'Add button sits under the cursor');
  assert.deepEqual(await js(`[...document.querySelectorAll('.bm-item')].map(e=>e.getAttribute('aria-label'))`),['Image 4','Image 11','Image 21']);
  assert.equal(await js(`document.querySelector('.bm-add').textContent`),'Add bookmarkHoldF/Enter');
  await wait(()=>js(`[...document.querySelectorAll('.bm-item img')].every(i=>i.complete&&i.naturalWidth===240)`));
  // 紧凑显示：没有文字；缩略图比例跟随视口但限制在 3:4 ~ 4:3，不显示成长条。
  assert.equal(await js(`document.querySelector('.bm-grid').innerText.trim()`),'');
  const want=await js('Math.min(4/3,Math.max(3/4,reader.clientWidth/reader.clientHeight))');
  assert.ok(Math.abs(await js(`(()=>{const r=document.querySelector('.bm-thumb');return r.offsetWidth/r.offsetHeight;})()`)-want)<.02,'Thumbnail ratio follows the viewport within 3:4 ~ 4:3');
  // 悬停即跳转；Esc 关闭并回到打开面板前的位置。
  const item=n=>rect(`.bm-item:nth-child(${n}) .bm-thumb`);
  let p=await item(3);await mouse('mouseMoved',p.x,p.y);await wait(async()=>(await center())[0]===20);
  await shot('panel');
  await key('Escape','keyDown');await key('Escape','keyUp');await wait(()=>js('document.querySelector(".bm-panel").hidden'));
  assert.deepEqual(await center(),start,'Esc restores the original position');
  // 离开面板：关闭并停在最后跳到的位置。
  await menu(300,400);p=await item(2);await mouse('mouseMoved',p.x,p.y);await wait(async()=>(await center())[0]===10);
  const box=await rect('.bm-panel');await mouse('mouseMoved',box.left-30,box.top+20);
  await wait(()=>js('document.querySelector(".bm-panel").hidden'));assert.deepEqual(await center(),[10,.25]);
  // 点击缩略图：跳转并关闭。
  await menu(300,400);p=await item(1);await mouse('mouseMoved',p.x,p.y);await mouse('mousePressed',p.x,p.y,'left');await mouse('mouseReleased',p.x,p.y,'left');
  await wait(()=>js('document.querySelector(".bm-panel").hidden'));assert.deepEqual(await center(),[3,.5]);
  // 悬停显示删除按钮，删除后同时清掉缩略图。
  await menu(300,400);p=await item(1);await mouse('mouseMoved',p.x,p.y);
  await wait(()=>js(`getComputedStyle(document.querySelector('.bm-item:nth-child(1) .bm-del')).opacity==='1'`));
  const del=await rect('.bm-item:nth-child(1) .bm-del');await mouse('mouseMoved',del.x,del.y);await mouse('mousePressed',del.x,del.y,'left');await mouse('mouseReleased',del.x,del.y,'left');
  await wait(async()=>(await marks()).length===2);assert.deepEqual(await marks(),[['10.svg',.25],['20.svg',.75]]);
  assert.equal(await js(`import('./store.mjs').then(({thumbs})=>thumbs('get','${thumbKey}'))`),undefined);
  assert.equal(await js('document.querySelectorAll(".bm-item").length'),2);assert.equal(await js('document.querySelector(".bm-panel").hidden'),false);
  await key('Escape','keyDown');await key('Escape','keyUp');await wait(()=>js('document.querySelector(".bm-panel").hidden'));

  // 书签按文件名定位：倒序排列后仍指向原图，面板按新页序显示。
  await js(`document.querySelector('#bar [data-act="sort"]').click()`);await wait(()=>js('sortOptions.open'));
  await js(`sortScope.value='folder';sortScope.dispatchEvent(new Event('change'));sortOptions.querySelector('[data-mode="nameDesc"]').click()`);
  await wait(async()=>(await record()).sortMode==='nameDesc');await js('reader.focus()');
  await js('reader.scrollTop=0');await tap();await wait(async()=>(await center())[0]===9);assert.equal(await text(),'Bookmark 1 / 2');
  await wait(()=>js(`document.querySelector('#reader [data-name="20.svg"]')?.style.top===${9*ph}+'px'`));
  await menu(300,400);assert.deepEqual(await js(`[...document.querySelectorAll('.bm-item')].map(e=>e.getAttribute('aria-label'))`),['Image 10','Image 20']);
  await key('Escape','keyDown');await key('Escape','keyUp');
  // 图片已不存在的书签显示为不可用，仍可删除。
  await js(`navigator.storage.getDirectory().then(r=>r.getDirectoryHandle('Marked')).then(d=>d.removeEntry('20.svg'))`);
  await js(`document.querySelector('#bar [data-act="refresh"]').click()`);await wait(async()=>(await record()).pages.length===29);
  await js('reader.focus()');await menu(300,400);
  assert.deepEqual(await js(`[...document.querySelectorAll('.bm-item')].map(e=>[e.classList.contains('gone'),e.getAttribute('aria-label')])`),[[false,'Image 19'],[true,'Image missing']]);
  await shot('panel-gone');
  const before=await center();p=await item(2);await mouse('mouseMoved',p.x,p.y);await delay(200);assert.deepEqual(await center(),before,'Missing bookmark does not jump');
  const del2=await rect('.bm-item:nth-child(2) .bm-del');await mouse('mouseMoved',del2.x,del2.y);await mouse('mousePressed',del2.x,del2.y,'left');await mouse('mouseReleased',del2.x,del2.y,'left');
  await wait(async()=>(await marks()).length===1);
  // 工具栏按钮（data-act="bookmarks"）：在阅读区中央打开，再按一次关闭。
  const act=`(()=>{const b=document.createElement('button');b.dataset.act='bookmarks';document.body.append(b);b.click();b.remove();})()`;
  await key('Escape','keyDown');await key('Escape','keyUp');await wait(()=>js('document.querySelector(".bm-panel").hidden'));
  await js(act);await wait(()=>js('!document.querySelector(".bm-panel").hidden'));await delay(200);const mid=await rect('.bm-panel');
  assert.ok(Math.abs(mid.x-await js('reader.clientWidth/2'))<2,'Toolbar action opens the panel centred');
  await js(act);await wait(()=>js('document.querySelector(".bm-panel").hidden'));
  assert.deepEqual(errors,[]);console.log('PASS: toolbar action, hold F to add with thumbnail, G unbound, duplicate guard, tap to cycle, Shift reverse, context panel, hover jump, leave/Esc, delete, reorder, missing images');
}finally{
  if(ws?.readyState===1){ws.send(JSON.stringify({id:++id,method:'Browser.close'}));ws.close();}
  server.close();for(let i=0;i<30&&chrome.exitCode===null;i++)await delay(100);if(chrome.exitCode===null)chrome.kill();
  await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:150});
}
