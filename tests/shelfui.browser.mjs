// 书架界面（焦点、增量更新、筛选、预设、导航范围、标签联想、存储提示、布局）端到端测试：独立临时配置 + OPFS 测试图，不读取用户的书库或浏览器配置。
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const binary=process.argv[2];if(!binary)throw Error('Usage: node tests/shelfui.browser.mjs <chrome-or-edge-executable>');
const profile=await mkdtemp(join(process.env.MV_TEST_TEMP||tmpdir(),'mv-shelfui-'));
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
  // 书架书签列表默认不常驻，这里固定为常驻（检查导航范围）。存储占用打桩为 90%，测试满额提示。
  await cdp('Page.addScriptToEvaluateOnNewDocument',{source:`Object.defineProperty(navigator,'languages',{value:['en-US']});if(localStorage.getItem('mv2:shelfmarks')===null)localStorage.setItem('mv2:shelfmarks','true');
    if(!localStorage.getItem('mv2:shelfSort'))localStorage.setItem('mv2:shelfSort','"nameAsc"');navigator.storage.estimate=async()=>({usage:90e6,quota:100e6});`});
  await cdp('Page.navigate',{url:origin});await wait(()=>js('document.querySelector("#empty")?.hidden===false'));
  // 80 本书 B01…B80，页数 1~5 张循环；封面比例三种循环，瀑布流里高度不同。
  await js(`(async()=>{const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('lib',{create:true});
    for(let i=1;i<=80;i++){const d=await root.getDirectoryHandle('B'+String(i).padStart(2,'0'),{create:true});
      for(let j=0;j<1+(i-1)%5;j++){const w=await (await d.getFileHandle(j+'.svg',{create:true})).createWritable();await w.write('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="'+(400+(i%3)*90)+'"><rect width="100%" height="100%" fill="hsl('+i*37+',50%,40%)"/></svg>');await w.close();}}
    window.showDirectoryPicker=async()=>root;document.querySelector('#empty [data-act="folder"]').click();})()`);
  const records=()=>js(`import('./store.mjs').then(({library})=>library('getAll'))`);
  const longWait=async check=>{for(let i=0;i<60;i++){if(await check().catch(()=>false))return;await delay(500);}throw Error('Timed out: '+check);};
  await longWait(async()=>{const r=await records();return r.length===80&&r.every(b=>b.fp?.thumb);});
  // 书签与标签直接写入记录后重新载入；当前书设为 B30（没有书签、没有标签）。
  await js(`(async()=>{const {library}=await import('./store.mjs');const all=await library('getAll'),by=n=>all.find(b=>b.title===n);
    for(const n of ['B10','B35','B60']){const b=by(n);b.bookmarks=[{id:'m'+n,name:b.pages[0].name,f:.5,at:Date.now()}];}
    by('B35').bookmarks.push({id:'m2',name:by('B35').pages[0].name,f:.8,at:Date.now()});
    by('B10').tags=['xtag'];by('B35').tags=['xtag','other'];by('B60').tags=['xother'];
    for(const b of all)await library('put',b);localStorage.setItem('mv2:last',JSON.stringify(by('B30').id));})()`);
  await cdp('Page.reload');await wait(()=>js(`bookTitle.textContent==='B30'`));
  const key=async(k,code,vk,extra={})=>{await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:k,code,windowsVirtualKeyCode:vk,...extra});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:k,code,windowsVirtualKeyCode:vk});};
  const K={b:['b','KeyB',66,{text:'b'}],down:['ArrowDown','ArrowDown',40],right:['ArrowRight','ArrowRight',39],left:['ArrowLeft','ArrowLeft',37],del:['Delete','Delete',46],enter:['Enter','Enter',13,{text:'\r'}],pgdn:['PageDown','PageDown',34],pgup:['PageUp','PageUp',33],esc:['Escape','Escape',27]};
  const press=k=>key(...K[k]);
  const active=()=>js(`(()=>{const c=document.activeElement?.closest('#books .book');return c&&{name:c.querySelector('.name').textContent,id:c.dataset.id,x:c.style.translate.split(' ')[0],y:parseFloat(c.style.translate.split(' ')[1]),on:c.classList.contains('active')};})()`);
  const visible=name=>js(`(()=>{const c=[...document.querySelectorAll('#books .book')].find(b=>b.querySelector('.name').textContent==='${name}');if(!c)return false;const r=c.getBoundingClientRect(),h=books.getBoundingClientRect();return r.top>=h.top&&r.bottom<=h.bottom;})()`);
  const names=()=>js(`[...document.querySelectorAll('#books .book')].map(b=>[+b.dataset.i,b.querySelector('.name').textContent]).sort((a,b)=>a[0]-b[0]).map(x=>x[1])`);
  // 1. 打开书架：焦点落在当前书 B30 的卡片上并滚入视野；只挂载可见范围附近的卡片。
  await js('reader.focus()');await press('b');await wait(()=>js('shelf.open'));
  const first=await active();assert.equal(first?.name,'B30','Focus lands on the current book');assert.ok(first.on,'Focused card is the selected one');
  assert.ok(await visible('B30'),'Current book is scrolled into view');assert.ok(await js('books.scrollTop>0'));
  const mounted=await js(`document.querySelectorAll('#books .book').length`);assert.ok(mounted>8&&mounted<80,'Only cards near the viewport are mounted: '+mounted);
  assert.equal(await js(`document.querySelectorAll('#books .book.active').length`),1);
  assert.equal(await js('layoutBtn.dataset.mode'),'grid','Plain grid by default');
  assert.equal(await js(`new Set([...document.querySelectorAll('#books .book')].map(b=>b.style.height)).size`),1,'Grid cells have equal height');
  // 2. 方向键按视觉位置移动；鼠标移到卡片上与键盘焦点是同一个状态。
  await press('down');let a=await active();assert.equal(a.x,first.x,'ArrowDown stays in the column');assert.ok(a.y>first.y);
  await press('left');let b=await active();assert.ok(parseFloat(b.x)<parseFloat(a.x),'ArrowLeft moves to the previous column');assert.equal(b.y,a.y);
  await press('right');assert.equal((await active()).name,a.name,'ArrowRight moves back');
  const r=await js(`(()=>{const c=[...document.querySelectorAll('#books .book')].find(x=>{const r=x.getBoundingClientRect(),h=books.getBoundingClientRect(),c=r.top+r.height/2;return !x.classList.contains('active')&&c>h.top+40&&c<h.bottom-40;});const r=c.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,name:c.querySelector('.name').textContent};})()`);
  await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.x,y:r.y});await wait(async()=>(await active())?.name===r.name);
  assert.equal(await js(`document.querySelectorAll('#books .book.active').length`),1,'Hover and keyboard share one selection');
  await press('down');assert.notEqual((await active()).name,r.name,'Keyboard continues from the hovered card');
  await shot('shelf-focus');
  // 3. 删除、移动后增量更新：其余卡片节点和已加载的封面保持不动，焦点交给相邻的书。
  await js('window.confirm=()=>true');
  const victim=await active();
  const witness=await wait(async()=>{const w=await js(`[...document.querySelectorAll('#books .book')].filter(n=>{const r=n.getBoundingClientRect(),h=books.getBoundingClientRect();return n.querySelector('.cover img')&&!n.classList.contains('active')&&(r.top+r.bottom)/2>=h.top&&(r.top+r.bottom)/2<=h.bottom;}).slice(0,3).map(n=>n.dataset.id)`);return w.length>=3&&w;});
  await js(`for(const n of document.querySelectorAll('#books .book')){n.__keep=1;const img=n.querySelector('.cover img');if(img)img.__keep=1;}`);
  assert.equal(witness.length,3);
  await press('del');await wait(async()=>(await records()).length===79);
  await wait(async()=>{const x=await active();return x&&x.id!==victim.id;});
  for(const id of witness)assert.equal(await js(`(()=>{const n=document.querySelector('#books .book[data-id="${id}"]');return !!n&&n.__keep===1&&n.querySelector('.cover img').__keep===1;})()`),true,'Unaffected cards and covers are reused');
  assert.equal(await js(`document.querySelector('[data-view="shelf"] .count').textContent`),'79');
  const mover=await active();await js(`document.querySelector('#books .book.active [aria-label="Move to library"]').click()`);
  await wait(async()=>{const x=await active();return x&&x.id!==mover.id;});
  for(const id of witness)assert.equal(await js(`document.querySelector('#books .book[data-id="${id}"]')?.__keep`),1);
  assert.equal(await js(`document.querySelector('[data-view="library"] .count').textContent`),'1');
  // 3b. 瀑布流：单按钮切换并持久保存；高度随封面比例；方向键、悬停与增量更新同样有效。
  await js('layoutBtn.click()');await wait(()=>js(`layoutBtn.dataset.mode==='masonry'`));
  assert.equal(await js(`localStorage.getItem('mv2:shelfLayout')`),'"masonry"');assert.equal(await js('layoutBtn.getAttribute("aria-label")'),'Layout: Masonry — click for Grid');
  await delay(450);assert.ok(await js(`new Set([...document.querySelectorAll('#books .book')].map(b=>b.style.height)).size>1`),'Masonry heights follow the covers');
  await js(`document.querySelector('#books .book.active .pick').focus()`);const m0=await active();assert.ok(m0?.on,"Selection survives the layout switch");
  await press('down');const m1=await active();assert.equal(m1.x,m0.x,'Masonry ArrowDown stays in the column');assert.ok(m1.y>m0.y);
  if(m1.x==='0px'){await press('right');assert.ok(parseFloat((await active()).x)>0);}else{await press('left');assert.ok(parseFloat((await active()).x)<parseFloat(m1.x));}
  const r2=await js(`(()=>{const c=[...document.querySelectorAll('#books .book')].find(x=>{const r=x.getBoundingClientRect(),h=books.getBoundingClientRect(),c=r.top+r.height/2;return !x.classList.contains('active')&&c>h.top+40&&c<h.bottom-40;});const r=c.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,name:c.querySelector('.name').textContent};})()`);
  await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:r2.x+3,y:r2.y+3});await wait(async()=>(await active())?.name===r2.name);
  await js(`for(const n of document.querySelectorAll('#books .book'))n.__keep=2`);
  const witness2=await js(`[...document.querySelectorAll('#books .book')].filter(n=>!n.classList.contains('active')).slice(0,3).map(n=>n.dataset.id)`);
  await js(`document.querySelector('#books .book.active [aria-label="Edit title"]').click()`);await wait(()=>js('renameBook.open'));
  await js(`renameInput.value='Renamed';renameForm.requestSubmit()`);await wait(async()=>(await active())?.name==='Renamed');
  for(const id of witness2)assert.equal(await js(`document.querySelector('#books .book[data-id="${id}"]')?.__keep`),2,'Masonry update reuses the other cards');
  await js(`document.querySelector('#books .book.active [aria-label="Edit title"]').click()`);await wait(()=>js('renameBook.open'));
  await js(`renameInput.value='';renameForm.requestSubmit()`);await wait(async()=>(await active())?.name===r2.name);
  await shot('shelf-masonry');
  // 4. 书签数显示在卡片上；“包含书签”筛选；筛选摘要与计数。
  await js(`query.value='B35';query.dispatchEvent(new Event('input',{bubbles:true}))`);await wait(async()=>JSON.stringify(await names())==='["B35"]');
  assert.equal(await js(`document.querySelector('#books .book .bm-flag').textContent`),'2');
  await js(`query.value='B30';query.dispatchEvent(new Event('input',{bubbles:true}))`);await wait(async()=>JSON.stringify(await names())==='["B30"]');
  assert.equal(await js(`document.querySelector('#books .book .bm-flag')`),null,'No badge without bookmarks');
  await js(`filters.reset()`);await wait(async()=>(await names()).length>5);
  await js('filterToggle.click()');assert.equal(await js('filterPanel.hidden'),false);
  await js('markedToggle.click()');await wait(async()=>JSON.stringify(await names())==='["B10","B35","B60"]');
  assert.equal(await js('shelfCount.textContent'),'3 / 78');assert.equal(await js('filterBadge.textContent'),'1');
  await js(`[...tagBar.querySelectorAll('button.tag')].find(x=>x.textContent.startsWith('xtag')).click()`);await wait(async()=>JSON.stringify(await names())==='["B10","B35"]');
  await js('filterToggle.click()');assert.equal(await js('filterSummary.hidden'),false);assert.equal(await js('filterBadge.textContent'),'2');
  await shot('shelf-filtered');
  // 5. 当前导航范围：上一本 / 下一本与书架书签列表只在筛选结果中；当前书 B30 不在结果里时走到排序上最近的一本。
  await js('shelf.close()');await wait(()=>js(`[...document.querySelectorAll('#shelfmarks .sm-book')].length===2`));
  assert.deepEqual(await js(`[...document.querySelectorAll('#shelfmarks .sm-book')].map(s=>s.getAttribute('aria-label'))`),['B10','B35']);
  await js('reader.focus()');await press('pgdn');await wait(()=>js(`bookTitle.textContent==='B35'`));
  await press('pgdn');await wait(()=>js(`bookTitle.textContent==='B10'`));await press('pgup');await wait(()=>js(`bookTitle.textContent==='B35'`));
  // 底部操作栏的上一本 / 下一本标出“只在筛选结果内切换”。
  const ih=await js('innerHeight');await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:500,y:ih-60});await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:500,y:ih-4});
  await wait(()=>js('!endbar.hidden'));
  assert.deepEqual(await js(`[...endbar.querySelectorAll('.eb-book')].map(b=>b.classList.contains('scoped')+'|'+b.title)`),['true|Previous book · Only switches within the shelf filter results','true|Next book · Only switches within the shelf filter results']);
  await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:500,y:300});
  // 6. 筛选条件持久保存；切换书架 / 书库时保持。
  await delay(700);await cdp('Page.reload');await wait(()=>js(`bookTitle.textContent==='B35'`));
  await js(`document.querySelector('#bar [data-act="shelf"]').click()`);await wait(()=>js('shelf.open'));
  await wait(async()=>JSON.stringify(await names())==='["B10","B35"]');assert.equal((await active()).name,'B35','Focus on the current book after reload');
  assert.equal(await js('filterSummary.hidden'),false);assert.equal(await js('layoutBtn.dataset.mode'),'masonry','Layout is remembered');
  await js(`document.querySelector('[data-view="library"]').click()`);await wait(async()=>(await names()).length===0);
  assert.equal(await js(`document.querySelector('#books .shelf-empty button')?.textContent`),'Clear filters','Empty result offers to clear the filter');
  await js(`document.querySelector('[data-view="shelf"]').click()`);await wait(async()=>(await names()).length===2);
  // 7. 搜索预设：保存、清除、应用、重命名、修改标记、删除。
  await js('presetBtn.click()');await wait(()=>js(`presetPop.matches(':popover-open')`));
  await js(`presetPop.querySelector('.pp-add').click()`);await wait(()=>js(`!!presetPop.querySelector('.pp-name input')`));
  await js(`(()=>{const f=presetPop.querySelector('.pp-name');f.querySelector('input').value='Marked';f.requestSubmit();})()`);
  await wait(()=>js(`presetName.textContent==='Marked'`));assert.equal(JSON.parse(await js(`localStorage.getItem('mv2:shelfPresets')`))[0].name,'Marked');
  await shot('shelf-presets');
  await press('esc');await wait(()=>js(`!presetPop.matches(':popover-open')`));assert.equal(await js('shelf.open'),true,'Esc closes only the popover');
  await js(`filterSummary.querySelector('.link-btn').click()`);await wait(async()=>(await names()).length>5);
  assert.equal(await js('presetName.textContent'),'Presets');
  await js('presetBtn.click()');await js(`presetPop.querySelector('.pp-apply').click()`);await wait(async()=>JSON.stringify(await names())==='["B10","B35"]');
  assert.equal(await js('presetName.textContent'),'Marked');
  await js('presetBtn.click()');await js(`presetPop.querySelector('.pp-row [aria-label="Rename"]').click()`);
  await js(`(()=>{const f=presetPop.querySelector('.pp-name');f.querySelector('input').value='Favourites';f.requestSubmit();})()`);
  await wait(()=>js(`presetName.textContent==='Favourites'`));await js('presetPop.hidePopover()');
  await js('filterToggle.click();markedToggle.click()');await wait(async()=>(await names()).length===2&&await js(`presetBtn.classList.contains('modified')`));
  await js('presetBtn.click()');await js(`presetPop.querySelector('.pp-row [aria-label="Delete preset"]').click()`);
  assert.equal(await js(`localStorage.getItem('mv2:shelfPresets')`),'[]');assert.equal(await js('presetName.textContent'),'Presets');await js('presetPop.hidePopover()');
  await js('filters.reset()');await wait(async()=>(await names()).length>5);
  // 8. 标签联想：输入即列出匹配的已有标签，↓ + Enter 选用；输入为空时最近用过的排在最前。
  await js(`query.value='B20';query.dispatchEvent(new Event('input',{bubbles:true}))`);await wait(async()=>JSON.stringify(await names())==='["B20"]');
  await js(`document.querySelector('#books .book [aria-label="Tags"]').click()`);await wait(()=>js('tagEditor.open'));
  await js(`tagInput.value='XT';tagInput.dispatchEvent(new Event('input'))`);
  assert.equal(await js(`tagSuggest.querySelector('.sug .tag').textContent`),'xtag');
  await js('tagInput.focus()');await press('down');assert.equal(await js(`tagSuggest.querySelector('[aria-selected=true] .tag').textContent`),'xtag');
  await press('enter');await wait(async()=>JSON.stringify((await records()).find(b=>b.title==='B20').tags)==='["xtag"]');
  await js('tagEditor.close()');
  await js(`query.value='B21';query.dispatchEvent(new Event('input',{bubbles:true}))`);await wait(async()=>JSON.stringify(await names())==='["B21"]');
  await js(`document.querySelector('#books .book [aria-label="Tags"]').click()`);await wait(()=>js('tagEditor.open'));
  assert.deepEqual(await js(`[...tagSuggest.querySelectorAll('.sug')].slice(0,1).map(s=>[s.querySelector('.tag').textContent,s.querySelector('small').textContent])`),[['xtag','Recent']]);
  await shot('tag-suggest');await js('tagEditor.close()');await js('filters.reset()');
  // 搜索框：Esc 先清空关键词，再回到列表；再按 Esc 关闭书架。
  await js(`query.focus();query.value='zzz';query.dispatchEvent(new Event('input',{bubbles:true}))`);await wait(async()=>(await names()).length===0);
  await press('esc');await wait(async()=>(await names()).length>5);assert.equal(await js('query.value+"|"+shelf.open'),'|true');
  await press('esc');assert.ok(await active(),'Second Esc returns to the list');assert.equal(await js('shelf.open'),true);
  // 9. 存储占用达到 85% 时在书架页提示。
  assert.equal(await js('storageWarn.hidden'),false);assert.ok((await js('storageWarn.textContent')).includes('90%'));
  // 10. 布局：筛选面板展开时书籍列表仍占大部分高度；约 500px 宽时工具条不溢出。
  await js('filterToggle.click()');
  assert.ok(await js('books.clientHeight>innerHeight*.55'),'List keeps most of the height');
  await cdp('Emulation.setDeviceMetricsOverride',{width:500,height:800,deviceScaleFactor:1,mobile:false});await delay(300);
  assert.ok(await js('filters.scrollWidth<=filters.clientWidth+1&&shelf.scrollWidth<=shelf.clientWidth+1'),'No horizontal overflow at 500px');
  assert.ok(await js('books.clientHeight>innerHeight*.45'),'List keeps enough height at 500px: '+await js('books.clientHeight'));
  assert.ok(await js(`[...filters.querySelectorAll('button,input,select')].filter(e=>e.offsetParent).every(e=>{const r=e.getBoundingClientRect();return r.right<=innerWidth+1&&r.left>=-1;})`),'Controls stay inside the window');
  await shot('shelf-narrow');
  // 11. 旧数据或损坏的偏好值不报错、不白屏。
  await cdp('Emulation.clearDeviceMetricsOverride');
  await js(`localStorage.setItem('mv2:shelfFilter','{"q":5,"tags":"x","min":"-3","max":"abc","preset":"nope"}');localStorage.setItem('mv2:shelfPresets','{"a":1}');localStorage.setItem('mv2:shelfLayout','"weird"');localStorage.setItem('mv2:recentTags','7');`);
  await js(`import('./store.mjs').then(async({library})=>{const all=await library('getAll');all[0].tags='bad';all[0].bookmarks=null;await library('put',all[0]);})`);
  await cdp('Page.reload');await wait(()=>js(`bookTitle.textContent==='B35'`));
  await js(`document.querySelector('#bar [data-act="shelf"]').click()`);await wait(()=>js('shelf.open'));await wait(async()=>(await names()).length>5);
  assert.equal(await js('layoutBtn.dataset.mode+"|"+query.value+"|"+filterBadge.textContent'),'grid||');
  assert.deepEqual(errors,[]);console.log('PASS: focus on current book, virtualized grid and masonry layouts (toggle, persistence), arrow keys, hover = focus, incremental delete / move, bookmark count, has-bookmarks filter, navigation scope, filter persistence across views and reloads, presets, tag suggestions, storage warning, compact layout, legacy / corrupt preferences');
}finally{
  if(ws?.readyState===1){ws.send(JSON.stringify({id:++id,method:'Browser.close'}));ws.close();}
  server.close();for(let i=0;i<30&&chrome.exitCode===null;i++)await delay(100);if(chrome.exitCode===null)chrome.kill();
  await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:150});
}
